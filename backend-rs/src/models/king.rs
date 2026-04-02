use chrono::{DateTime, Utc};
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

use crate::schema::kings;

/// Queryable struct -- field order matches `kings` table columns exactly.
#[derive(Debug, Clone, Queryable, Selectable, Serialize, Deserialize)]
#[diesel(table_name = kings)]
#[diesel(check_for_backend(diesel::pg::Pg))]
pub struct King {
    pub id: i32,
    pub token_id: i32,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
}
