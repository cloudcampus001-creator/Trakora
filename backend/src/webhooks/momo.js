const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder-url.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key';
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * POST /api/webhooks/momo
 * MTN MoMo / Orange Money Payment Webhook
 */
router.post('/momo', async (req, res) => {
  const signature = req.headers['x-momo-signature'] || req.headers['authorization'];
  const payload = req.body;

  console.log('📬 Received Mobile Money Webhook:', JSON.stringify(payload, null, 2));

  // 1. Signature Verification (Simplified mock/real validation)
  if (process.env.NODE_ENV === 'production' && !signature) {
    return res.status(401).json({ error: 'Missing webhook signature verification' });
  }

  const {
    financialTransactionId, // Provider reference
    externalId,             // Our database transaction reference / code
    amount,                 // Transaction amount
    currency,
    payer,                  // { partyIdType: 'MSISDN', partyId: '256770000000' } (Phone number)
    status                  // 'SUCCESSFUL', 'FAILED', 'REJECTED'
  } = payload;

  try {
    const isSuccess = status === 'SUCCESSFUL' || status === 'SUCCESS';
    const finalStatus = isSuccess ? 'success' : 'failed';

    console.log(`Processing transaction reference ${externalId}: status = ${finalStatus}, amount = ${amount}`);

    // 2. Update Supabase Transaction Ledger
    // In a live app, we query the transaction by reference_code and update its status
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const { data, error } = await supabase
        .from('transactions')
        .update({
          status: finalStatus,
          metadata: {
            momo_provider_id: financialTransactionId,
            payer_phone: payer?.partyId || 'unknown',
            webhook_raw: payload
          }
        })
        .eq('reference_code', externalId)
        .select();

      if (error) {
        console.error('❌ Supabase ledger update error:', error.message);
        throw error;
      }
      console.log('✅ Successfully updated transaction in database ledger:', data);
    } else {
      console.log('ℹ️ Sandbox Mode: Supabase not configured. Transaction status simulated.');
    }

    // 3. Respond 200 OK to the MoMo provider
    return res.status(200).json({
      status: 'PROCESSED',
      externalId: externalId,
      processedAt: new Date().toISOString()
    });

  } catch (err) {
    console.error('💥 Error processing MoMo Webhook:', err.message);
    return res.status(500).json({
      status: 'ERROR',
      message: err.message
    });
  }
});

/**
 * POST /api/webhooks/simulate-momo
 * Helper endpoint to let the frontend simulate a payment trigger
 */
router.post('/simulate-momo', async (req, res) => {
  const { transactionId, studentId, amount, phone, schoolId } = req.body;

  console.log(`🤖 Simulating MoMo payment for student ${studentId}, amount ${amount}`);

  // Construct standard MTN MoMo status payload
  const mockPayload = {
    financialTransactionId: 'TX-' + Math.floor(Math.random() * 10000000),
    externalId: transactionId,
    amount: amount.toString(),
    currency: 'UGX',
    payer: {
      partyIdType: 'MSISDN',
      partyId: phone || '256771234567'
    },
    status: 'SUCCESSFUL'
  };

  try {
    // If Supabase is connected, we ensure a pending transaction exists first,
    // then trigger the webhook flow locally.
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      // 1. Create the pending ledger transaction
      const { error: insertErr } = await supabase
        .from('transactions')
        .insert({
          school_id: schoolId,
          student_id: studentId,
          amount: parseFloat(amount),
          type: 'credit',
          method: 'momo',
          status: 'pending',
          reference_code: transactionId,
          notes: `MoMo charge simulated for ${phone}`
        });

      if (insertErr) {
        console.error('❌ Failed to insert pending transaction:', insertErr);
        return res.status(500).json({ error: insertErr.message });
      }
    }

    // 2. Trigger webhook handler locally
    const axios = require('axios');
    // Using simple fetch / request simulation inside this process to avoid full HTTP loop failure
    // We can directly perform database operations or let the user see it succeed.
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const { error: updateErr } = await supabase
        .from('transactions')
        .update({
          status: 'success',
          metadata: {
            momo_provider_id: mockPayload.financialTransactionId,
            payer_phone: phone,
            simulated: true
          }
        })
        .eq('reference_code', transactionId);

      if (updateErr) throw updateErr;
    }

    return res.status(200).json({
      success: true,
      message: 'MoMo Payment Successful (Simulated)',
      payload: mockPayload
    });

  } catch (error) {
    console.error('Simulation error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
