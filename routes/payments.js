import express from 'express';
import axios from 'axios';
import db from '../database/db.js';
import { authenticateToken } from '../middleware/auth.js';
import hardwareService from '../services/hardware.js';

const router = express.Router();

// M-Pesa configuration
const MPESA_CONFIG = {
    consumerKey: process.env.MPESA_CONSUMER_KEY,
    consumerSecret: process.env.MPESA_CONSUMER_SECRET,
    businessShortCode: process.env.MPESA_BUSINESS_SHORT_CODE,
    passkey: process.env.MPESA_PASSKEY,
    callbackUrl: process.env.MPESA_CALLBACK_URL,
    environment: process.env.MPESA_ENVIRONMENT || 'sandbox'
};

const MPESA_BASE_URL = MPESA_CONFIG.environment === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

// Get M-Pesa access token
async function getMpesaAccessToken() {
    try {
        const auth = Buffer.from(`${MPESA_CONFIG.consumerKey}:${MPESA_CONFIG.consumerSecret}`).toString('base64');

        const response = await axios.get(`${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
            headers: {
                Authorization: `Basic ${auth}`
            }
        });

        return response.data.access_token;
    } catch (error) {
        console.error('Error getting M-Pesa access token:', error.response?.data || error.message);
        throw new Error('Failed to get M-Pesa access token');
    }
}

// Initiate M-Pesa STK Push
router.post('/mpesa', authenticateToken, async (req, res) => {
    try {
        const { sale_id, phone, amount } = req.body;

        if (!sale_id || !phone || !amount) {
            return res.status(400).json({ error: 'Sale ID, phone number, and amount are required' });
        }

        // Validate sale exists
        const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(sale_id);
        if (!sale) {
            return res.status(404).json({ error: 'Sale not found' });
        }

        // Format phone number (remove + and ensure it starts with 254)
        let formattedPhone = phone.replace(/\D/g, '');
        if (formattedPhone.startsWith('0')) {
            formattedPhone = '254' + formattedPhone.substring(1);
        } else if (!formattedPhone.startsWith('254')) {
            formattedPhone = '254' + formattedPhone;
        }

        // Get access token
        const accessToken = await getMpesaAccessToken();

        // Generate timestamp
        const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);

        // Generate password
        const password = Buffer.from(
            `${MPESA_CONFIG.businessShortCode}${MPESA_CONFIG.passkey}${timestamp}`
        ).toString('base64');

        // STK Push request
        const stkPushResponse = await axios.post(
            `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
            {
                BusinessShortCode: MPESA_CONFIG.businessShortCode,
                Password: password,
                Timestamp: timestamp,
                TransactionType: 'CustomerPayBillOnline',
                Amount: Math.round(amount),
                PartyA: formattedPhone,
                PartyB: MPESA_CONFIG.businessShortCode,
                PhoneNumber: formattedPhone,
                CallBackURL: MPESA_CONFIG.callbackUrl,
                AccountReference: `SALE${sale_id}`,
                TransactionDesc: `Payment for Sale #${sale_id}`
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            }
        );

        // Create pending payment record
        const paymentResult = db.prepare(`
      INSERT INTO payments (sale_id, method, amount, mpesa_phone, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(sale_id, 'mpesa', amount, formattedPhone, 'pending');

        res.json({
            success: true,
            message: 'STK Push sent successfully',
            checkout_request_id: stkPushResponse.data.CheckoutRequestID,
            payment_id: paymentResult.lastInsertRowid
        });

    } catch (error) {
        console.error('M-Pesa STK Push error:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Failed to initiate M-Pesa payment',
            details: error.response?.data || error.message
        });
    }
});

// Helper to fetch sale details for printing
function getSaleDetails(sale_id) {
    const sale = db.prepare(`
        SELECT s.*, u.username as user_name 
        FROM sales s 
        LEFT JOIN users u ON s.cashier_id = u.id 
        WHERE s.id = ?
    `).get(sale_id);

    const items = db.prepare(`
        SELECT si.*, p.name as product_name 
        FROM sale_items si
        LEFT JOIN products p ON si.product_id = p.id
        WHERE si.sale_id = ?
    `).all(sale_id);

    return { sale, items };
}

// M-Pesa callback handler
router.post('/mpesa/callback', async (req, res) => {
    try {
        console.log('M-Pesa Callback received:', JSON.stringify(req.body, null, 2));

        const { Body } = req.body;

        if (Body && Body.stkCallback) {
            const { ResultCode, ResultDesc, CallbackMetadata } = Body.stkCallback;

            if (ResultCode === 0) {
                // Payment successful
                const metadata = CallbackMetadata.Item;
                const mpesaReceiptNumber = metadata.find(item => item.Name === 'MpesaReceiptNumber')?.Value;
                const transactionDate = metadata.find(item => item.Name === 'TransactionDate')?.Value;
                const phoneNumber = metadata.find(item => item.Name === 'PhoneNumber')?.Value;

                // Update payment record
                const payment = db.prepare(`
                  UPDATE payments
                  SET status = 'completed', mpesa_receipt = ?, mpesa_transaction_id = ?
                  WHERE mpesa_phone = ? AND status = 'pending'
                  ORDER BY created_at DESC
                  LIMIT 1
                  RETURNING *
                `).get(mpesaReceiptNumber, transactionDate, phoneNumber);

                console.log('✅ M-Pesa payment completed:', mpesaReceiptNumber);

                if (payment) {
                    // Trigger receipt print
                    const { sale, items } = getSaleDetails(payment.sale_id);
                    if (sale) {
                        hardwareService.printReceipt(sale, items);
                    }
                }

            } else {
                // Payment failed
                console.log('❌ M-Pesa payment failed:', ResultDesc);

                // Update payment status to failed
                db.prepare(`
          UPDATE payments
          SET status = 'failed'
          WHERE status = 'pending'
          ORDER BY created_at DESC
          LIMIT 1
        `).run();
            }
        }

        // Always respond with success to M-Pesa
        res.json({ ResultCode: 0, ResultDesc: 'Success' });

    } catch (error) {
        console.error('Error processing M-Pesa callback:', error);
        res.json({ ResultCode: 0, ResultDesc: 'Success' });
    }
});

// Record cash payment
router.post('/cash', authenticateToken, (req, res) => {
    try {
        const { sale_id, amount, amount_tendered } = req.body;

        if (!sale_id || !amount) {
            return res.status(400).json({ error: 'Sale ID and amount are required' });
        }

        const result = db.prepare(`
      INSERT INTO payments (sale_id, method, amount, status)
      VALUES (?, ?, ?, ?)
    `).run(sale_id, 'cash', amount, 'completed');

        const change = amount_tendered ? amount_tendered - amount : 0;

        // Trigger Receipt Print
        const { sale, items } = getSaleDetails(sale_id);
        if (sale) {
            sale.amount_tendered = amount_tendered;
            hardwareService.printReceipt(sale, items);
        }

        res.json({
            success: true,
            payment_id: result.lastInsertRowid,
            change,
            message: 'Cash payment recorded successfully'
        });
    } catch (error) {
        console.error('Error recording cash payment:', error);
        res.status(500).json({ error: 'Failed to record cash payment' });
    }
});

// Record card payment
router.post('/card', authenticateToken, (req, res) => {
    try {
        const { sale_id, amount } = req.body;

        if (!sale_id || !amount) {
            return res.status(400).json({ error: 'Sale ID and amount are required' });
        }

        const result = db.prepare(`
      INSERT INTO payments (sale_id, method, amount, status)
      VALUES (?, ?, ?, ?)
    `).run(sale_id, 'card', amount, 'completed');

        // Trigger Receipt Print
        const { sale, items } = getSaleDetails(sale_id);
        if (sale) {
            hardwareService.printReceipt(sale, items);
        }

        res.json({
            success: true,
            payment_id: result.lastInsertRowid,
            message: 'Card payment recorded successfully'
        });
    } catch (error) {
        console.error('Error recording card payment:', error);
        res.status(500).json({ error: 'Failed to record card payment' });
    }
});

// Check payment status
router.get('/:payment_id/status', authenticateToken, (req, res) => {
    try {
        const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.payment_id);

        if (!payment) {
            return res.status(404).json({ error: 'Payment not found' });
        }

        res.json(payment);
    } catch (error) {
        console.error('Error fetching payment status:', error);
        res.status(500).json({ error: 'Failed to fetch payment status' });
    }
});

export default router;
