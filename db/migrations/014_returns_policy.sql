-- Returns policy for expiry and breakage claims, and what the checks found on each claim.
alter table claims add column flags jsonb not null default '[]'::jsonb;
insert into settings(key,value,label,unit) values
 ('return_before_expiry_months','3','An expiry return can be claimed from this long before the expiry date','months'),
 ('return_after_expiry_months','6','An expired-stock return must be claimed within this long after expiry','months'),
 ('return_cap_pct','2','Expiry returns in 12 months may reach this share of the customer''s purchases','%'),
 ('breakage_claim_days','15','A breakage claim must come within this long after a dispatch','days')
on conflict(key) do nothing;
