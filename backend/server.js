import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Critical to bypass RLS here during updates
);

// Unified Webhook for Telecom Operators (MTN MoMo / Orange Money)
app.post('/api/webhooks/momo', async (req, res) => {
  const { transactionId, status, externalReference, amount } = req.body;

  try {
    // 1. Locate the pending record
    const { data: tx, error: findError } = await supabase
      .from('financial_transactions')
      .select('*, students(id, class_id, is_registered, tuition_paid)')
      .eq('id', transactionId)
      .single();

    if (findError || !tx) {
      return res.status(404).json({ error: 'Transaction record not found' });
    }

    if (status === 'SUCCESSFUL') {
      // 2. Update transaction state
      await supabase
        .from('financial_transactions')
        .update({ status: 'COMPLETED', operator_reference: externalReference })
        .eq('id', transactionId);

      // 3. Process structural accounting changes
      if (tx.type === 'REGISTRATION') {
        await supabase
          .from('students')
          .update({ is_registered: true })
          .eq('id', tx.student_id);
      } else if (tx.type === 'TUITION') {
        const structuralNewBalance = Number(tx.students.tuition_paid) + Number(amount);
        await supabase
          .from('students')
          .update({ tuition_paid: structuralNewBalance })
          .eq('id', tx.student_id);
      }
    } else {
      await supabase
        .from('financial_transactions')
        .update({ status: 'FAILED' })
        .eq('id', transactionId);
    }

    return res.status(200).json({ status: 'PROCESSED' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Fintech Pipeline active on port ${PORT}`));