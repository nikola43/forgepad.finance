use diesel::prelude::*;
use serde::{Deserialize, Serialize};

use crate::schema::{referral_info, referrals};

/// Queryable struct -- field order matches `referrals` table columns exactly.
#[derive(Debug, Clone, Queryable, Selectable, Serialize)]
#[diesel(table_name = referrals)]
#[diesel(check_for_backend(diesel::pg::Pg))]
pub struct Referral {
    pub id: i32,
    pub referrer_id: i32,
    pub referee_id: i32,
}

/// Insertable struct for creating a new referral.
#[derive(Debug, Clone, Insertable, Deserialize)]
#[diesel(table_name = referrals)]
pub struct NewReferral {
    pub referrer_id: i32,
    pub referee_id: i32,
}

/// Queryable struct -- field order matches `referral_info` table columns exactly.
#[derive(Debug, Clone, Queryable, Selectable, Serialize)]
#[diesel(table_name = referral_info)]
#[diesel(check_for_backend(diesel::pg::Pg))]
pub struct ReferralInfo {
    pub id: i32,
    pub user_id: i32,
    pub referral_code: String,
    pub earnings: i32,
}

/// Insertable struct for creating referral info.
#[derive(Debug, Clone, Insertable, Deserialize)]
#[diesel(table_name = referral_info)]
pub struct NewReferralInfo {
    pub user_id: i32,
    pub referral_code: String,
}
