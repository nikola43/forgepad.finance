use diesel::prelude::*;
use serde::{Deserialize, Serialize};

use crate::schema::admins;

/// Queryable struct -- field order matches `admins` table columns exactly.
#[derive(Debug, Clone, Queryable, Selectable, Serialize, Deserialize)]
#[diesel(table_name = admins)]
#[diesel(check_for_backend(diesel::pg::Pg))]
pub struct Admin {
    pub id: i32,
    pub user_id: i32,
    pub penalized: bool,
}
