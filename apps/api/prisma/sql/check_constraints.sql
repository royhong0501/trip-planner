-- Check constraints that Prisma's DSL cannot express.
-- Applied by `scripts/applyCheckConstraints.ts` after `prisma migrate deploy`.
-- Safe to re-run: each ALTER is wrapped in DROP IF EXISTS first.

ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_category_enum;
ALTER TABLE trips ADD CONSTRAINT trips_category_enum
  CHECK (category IN ('domestic', 'international'));

ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_status_enum;
ALTER TABLE trips ADD CONSTRAINT trips_status_enum
  CHECK (status IN ('planning', 'ongoing', 'completed'));

ALTER TABLE trip_participants DROP CONSTRAINT IF EXISTS trip_participants_display_name_not_empty;
ALTER TABLE trip_participants ADD CONSTRAINT trip_participants_display_name_not_empty
  CHECK (char_length(trim(display_name)) > 0);

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_amount_total_non_negative;
ALTER TABLE expenses ADD CONSTRAINT expenses_amount_total_non_negative
  CHECK (amount_total >= 0);

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_exchange_rate_positive;
ALTER TABLE expenses ADD CONSTRAINT expenses_exchange_rate_positive
  CHECK (exchange_rate > 0);

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_title_not_empty;
ALTER TABLE expenses ADD CONSTRAINT expenses_title_not_empty
  CHECK (char_length(trim(title)) > 0);

ALTER TABLE expense_splits DROP CONSTRAINT IF EXISTS expense_splits_owed_non_negative;
ALTER TABLE expense_splits ADD CONSTRAINT expense_splits_owed_non_negative
  CHECK (owed_amount >= 0);
