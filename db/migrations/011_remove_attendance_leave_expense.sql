-- Attendance, leave and expense claims are removed: the system is for orders, booklets and the sales process.
-- Customer visits stay and no longer need a day check-in.
drop table if exists expenses;
drop table if exists leaves;
drop table if exists attendance;
delete from approvals where doc_type in ('expenses','leave');
delete from notifications where link in ('/r/expenses','/r/leave');
delete from alerts where rule in ('no_checkin','idle','missed_checkout','expense_gps');
delete from alert_rules where key in ('no_checkin','idle','missed_checkout','expense_gps');
delete from settings where key in ('checkin_late_after_min','selfie_required','ta_rate_per_km','da_daily_limit','km_tolerance_pct');
delete from photos where kind = 'checkin';
update roles set permissions = coalesce((select jsonb_agg(p) from jsonb_array_elements_text(permissions) p
  where p not in ('expenses.create','expenses.approve','expenses.pay','leave.apply','leave.approve')), '[]'::jsonb);
