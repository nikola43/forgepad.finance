diesel::table! {
    use diesel::sql_types::*;

    users (id) {
        id -> Int4,
        address -> Varchar,
        username -> Nullable<Varchar>,
        avatar -> Nullable<Varchar>,
        bio -> Nullable<Text>,
        likes -> Int4,
        twitter_id -> Nullable<Varchar>,
        twitter_name -> Nullable<Varchar>,
        twitter_username -> Nullable<Varchar>,
        twitter_access -> Nullable<Varchar>,
        twitter_profile_picture -> Nullable<Varchar>,
        twitter_verified -> Bool,
        created_at -> Timestamptz,
        updated_at -> Timestamptz,
    }
}

diesel::table! {
    use diesel::sql_types::*;
    use super::sql_types::*;

    tokens (id) {
        id -> Int4,
        token_address -> Varchar,
        name -> Varchar,
        symbol -> Varchar,
        description -> Nullable<Text>,
        image -> Nullable<Varchar>,
        banner -> Nullable<Varchar>,
        creator_id -> Int4,
        network -> Varchar,
        marketcap -> Numeric,
        price -> Numeric,
        eth_price -> Numeric,
        volume -> Numeric,
        score -> Numeric,
        virtual_eth_amount -> Numeric,
        virtual_token_amount -> Numeric,
        pair_address -> Nullable<Varchar>,
        pool_type -> PoolTypeMapping,
        category -> TokenCategoryMapping,
        reply_count -> Int4,
        web_link -> Nullable<Varchar>,
        telegram_link -> Nullable<Varchar>,
        twitter_link -> Nullable<Varchar>,
        launched_at -> Nullable<Timestamptz>,
        created_at -> Timestamptz,
        updated_at -> Timestamptz,
    }
}

diesel::table! {
    use diesel::sql_types::*;
    use super::sql_types::*;

    trades (id) {
        id -> Int4,
        token_id -> Int4,
        swapper_id -> Int4,
        trade_type -> TradeTypeMapping,
        eth_amount -> Numeric,
        token_amount -> Numeric,
        token_price -> Numeric,
        eth_price -> Numeric,
        tx_hash -> Varchar,
        traded_at -> Int8,
        created_at -> Timestamptz,
    }
}

diesel::table! {
    chats (id) {
        id -> Int4,
        token_id -> Int4,
        author_id -> Int4,
        parent_id -> Nullable<Int4>,
        content -> Text,
        code -> Nullable<Varchar>,
        network -> Varchar,
        created_at -> Timestamptz,
    }
}

diesel::table! {
    holders (id) {
        id -> Int4,
        token_id -> Int4,
        user_id -> Int4,
        amount -> Numeric,
    }
}

diesel::table! {
    follows (id) {
        id -> Int4,
        follower_id -> Int4,
        followee_id -> Int4,
        created_at -> Timestamptz,
    }
}

diesel::table! {
    referrals (id) {
        id -> Int4,
        referrer_id -> Int4,
        referee_id -> Int4,
    }
}

diesel::table! {
    referral_info (id) {
        id -> Int4,
        user_id -> Int4,
        referral_code -> Varchar,
        earnings -> Int4,
    }
}

diesel::table! {
    token_creation_requests (id) {
        id -> Int4,
        creator_address -> Varchar,
        body -> Jsonb,
        created_at -> Timestamptz,
    }
}

diesel::table! {
    kings (id) {
        id -> Int4,
        token_id -> Int4,
        started_at -> Timestamptz,
        ended_at -> Nullable<Timestamptz>,
    }
}

diesel::table! {
    admins (id) {
        id -> Int4,
        user_id -> Int4,
        penalized -> Bool,
    }
}

diesel::table! {
    indexing_state (id) {
        id -> Int4,
        network -> Varchar,
        last_block -> Int8,
        updated_at -> Timestamptz,
    }
}

// Foreign key join definitions
diesel::joinable!(tokens -> users (creator_id));
diesel::joinable!(trades -> tokens (token_id));
diesel::joinable!(trades -> users (swapper_id));
diesel::joinable!(chats -> tokens (token_id));
diesel::joinable!(holders -> tokens (token_id));
diesel::joinable!(holders -> users (user_id));
diesel::joinable!(kings -> tokens (token_id));
diesel::joinable!(admins -> users (user_id));
diesel::joinable!(referral_info -> users (user_id));

diesel::allow_tables_to_appear_in_same_query!(
    users,
    tokens,
    trades,
    chats,
    holders,
    follows,
    referrals,
    referral_info,
    token_creation_requests,
    kings,
    admins,
    indexing_state,
);

pub mod sql_types {
    #[derive(diesel::query_builder::QueryId, diesel::sql_types::SqlType)]
    #[diesel(postgres_type(name = "pool_type"))]
    pub struct PoolTypeMapping;

    #[derive(diesel::query_builder::QueryId, diesel::sql_types::SqlType)]
    #[diesel(postgres_type(name = "token_category"))]
    pub struct TokenCategoryMapping;

    #[derive(diesel::query_builder::QueryId, diesel::sql_types::SqlType)]
    #[diesel(postgres_type(name = "trade_type"))]
    pub struct TradeTypeMapping;
}
