use diesel::deserialize::{self, FromSql};
use diesel::pg::{Pg, PgValue};
use diesel::serialize::{self, IsNull, Output, ToSql};
use diesel::{AsExpression, FromSqlRow};
use serde::{Deserialize, Serialize};
use std::io::Write;

use crate::schema::sql_types::{PoolTypeMapping, TokenCategoryMapping, TradeTypeMapping};

// ---------------------------------------------------------------------------
// PoolType
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, AsExpression, FromSqlRow)]
#[diesel(sql_type = PoolTypeMapping)]
pub enum PoolType {
    V2,
    V3,
    V4,
    Direct,
}

impl Serialize for PoolType {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            PoolType::V2 => serializer.serialize_str("v2"),
            PoolType::V3 => serializer.serialize_str("v3"),
            PoolType::V4 => serializer.serialize_str("v4"),
            PoolType::Direct => serializer.serialize_str("direct"),
        }
    }
}

impl<'de> Deserialize<'de> for PoolType {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        match s.as_str() {
            "v2" | "V2" => Ok(PoolType::V2),
            "v3" | "V3" => Ok(PoolType::V3),
            "v4" | "V4" => Ok(PoolType::V4),
            "direct" | "Direct" => Ok(PoolType::Direct),
            other => Err(serde::de::Error::custom(format!(
                "unknown pool type: {other}"
            ))),
        }
    }
}

impl ToSql<PoolTypeMapping, Pg> for PoolType {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Pg>) -> serialize::Result {
        let value = match self {
            PoolType::V2 => "v2",
            PoolType::V3 => "v3",
            PoolType::V4 => "v4",
            PoolType::Direct => "direct",
        };
        out.write_all(value.as_bytes())?;
        Ok(IsNull::No)
    }
}

impl FromSql<PoolTypeMapping, Pg> for PoolType {
    fn from_sql(bytes: PgValue<'_>) -> deserialize::Result<Self> {
        match bytes.as_bytes() {
            b"v2" => Ok(PoolType::V2),
            b"v3" => Ok(PoolType::V3),
            b"v4" => Ok(PoolType::V4),
            b"direct" => Ok(PoolType::Direct),
            other => Err(format!(
                "unrecognized pool_type variant: {}",
                String::from_utf8_lossy(other)
            )
            .into()),
        }
    }
}

// ---------------------------------------------------------------------------
// TokenCategory
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, AsExpression, FromSqlRow)]
#[diesel(sql_type = TokenCategoryMapping)]
pub enum TokenCategory {
    Normal,
    Nsfw,
}

impl Serialize for TokenCategory {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            TokenCategory::Normal => serializer.serialize_str("normal"),
            TokenCategory::Nsfw => serializer.serialize_str("nsfw"),
        }
    }
}

impl<'de> Deserialize<'de> for TokenCategory {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        match s.as_str() {
            "normal" | "Normal" => Ok(TokenCategory::Normal),
            "nsfw" | "Nsfw" | "NSFW" => Ok(TokenCategory::Nsfw),
            other => Err(serde::de::Error::custom(format!(
                "unknown token category: {other}"
            ))),
        }
    }
}

impl ToSql<TokenCategoryMapping, Pg> for TokenCategory {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Pg>) -> serialize::Result {
        let value = match self {
            TokenCategory::Normal => "normal",
            TokenCategory::Nsfw => "nsfw",
        };
        out.write_all(value.as_bytes())?;
        Ok(IsNull::No)
    }
}

impl FromSql<TokenCategoryMapping, Pg> for TokenCategory {
    fn from_sql(bytes: PgValue<'_>) -> deserialize::Result<Self> {
        match bytes.as_bytes() {
            b"normal" => Ok(TokenCategory::Normal),
            b"nsfw" => Ok(TokenCategory::Nsfw),
            other => Err(format!(
                "unrecognized token_category variant: {}",
                String::from_utf8_lossy(other)
            )
            .into()),
        }
    }
}

// ---------------------------------------------------------------------------
// TradeType
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, AsExpression, FromSqlRow)]
#[diesel(sql_type = TradeTypeMapping)]
pub enum TradeType {
    Buy,
    Sell,
}

impl Serialize for TradeType {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            TradeType::Buy => serializer.serialize_str("buy"),
            TradeType::Sell => serializer.serialize_str("sell"),
        }
    }
}

impl<'de> Deserialize<'de> for TradeType {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        match s.as_str() {
            "buy" | "Buy" => Ok(TradeType::Buy),
            "sell" | "Sell" => Ok(TradeType::Sell),
            other => Err(serde::de::Error::custom(format!(
                "unknown trade type: {other}"
            ))),
        }
    }
}

impl ToSql<TradeTypeMapping, Pg> for TradeType {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Pg>) -> serialize::Result {
        let value = match self {
            TradeType::Buy => "buy",
            TradeType::Sell => "sell",
        };
        out.write_all(value.as_bytes())?;
        Ok(IsNull::No)
    }
}

impl FromSql<TradeTypeMapping, Pg> for TradeType {
    fn from_sql(bytes: PgValue<'_>) -> deserialize::Result<Self> {
        match bytes.as_bytes() {
            b"buy" => Ok(TradeType::Buy),
            b"sell" => Ok(TradeType::Sell),
            other => Err(format!(
                "unrecognized trade_type variant: {}",
                String::from_utf8_lossy(other)
            )
            .into()),
        }
    }
}
