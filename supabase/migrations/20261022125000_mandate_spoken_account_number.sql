-- Additive migration: allow mandates to target either a saved contact or a
-- spoken recipient name with a digit-by-digit account number (6 to 20 digits).

ALTER TABLE mandates
  ALTER COLUMN payee_contact_id DROP NOT NULL;

ALTER TABLE mandates
  ADD COLUMN IF NOT EXISTS payee_name TEXT,
  ADD COLUMN IF NOT EXISTS payee_account_number TEXT;

ALTER TABLE mandates
  ADD CONSTRAINT mandates_recipient_target_check CHECK (
    payee_contact_id IS NOT NULL
    OR (
      payee_name IS NOT NULL
      AND length(btrim(payee_name)) > 0
      AND payee_account_number IS NOT NULL
      AND payee_account_number ~ '^[0-9]{6,20}$'
    )
  );
