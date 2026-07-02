// @generated automatically by Diesel CLI.

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

diesel::table! {
    admins (id) {
        id -> Int4,
        user_id -> Int4,
        penalized -> Bool,
    }
}

diesel::table! {
    chats (id) {
        id -> Int4,
        token_id -> Int4,
        author_id -> Int4,
        parent_id -> Nullable<Int4>,
        content -> Text,
        #[max_length = 255]
        code -> Nullable<Varchar>,
        #[max_length = 50]
        network -> Varchar,
        created_at -> Timestamptz,
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
    holders (id) {
        id -> Int4,
        token_id -> Int4,
        user_id -> Int4,
        amount -> Numeric,
    }
}

diesel::table! {
    indexing_state (id) {
        id -> Int4,
        #[max_length = 50]
        network -> Varchar,
        last_block -> Int8,
        updated_at -> Timestamptz,
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
    referral_info (id) {
        id -> Int4,
        user_id -> Int4,
        #[max_length = 10]
        referral_code -> Varchar,
        earnings -> Int4,
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
    token_creation_requests (id) {
        id -> Int4,
        #[max_length = 50]
        creator_address -> Varchar,
        body -> Jsonb,
        created_at -> Timestamptz,
    }
}

diesel::table! {
    use diesel::sql_types::*;
    use super::sql_types::PoolTypeMapping;
    use super::sql_types::TokenCategoryMapping;

    tokens (id) {
        id -> Int4,
        #[max_length = 50]
        token_address -> Varchar,
        #[max_length = 60]
        name -> Varchar,
        #[max_length = 30]
        symbol -> Varchar,
        description -> Nullable<Text>,
        #[max_length = 255]
        image -> Nullable<Varchar>,
        #[max_length = 255]
        banner -> Nullable<Varchar>,
        creator_id -> Int4,
        #[max_length = 50]
        network -> Varchar,
        marketcap -> Numeric,
        price -> Numeric,
        eth_price -> Numeric,
        volume -> Numeric,
        score -> Numeric,
        virtual_eth_amount -> Numeric,
        virtual_token_amount -> Numeric,
        #[max_length = 50]
        pair_address -> Nullable<Varchar>,
        pool_type -> PoolTypeMapping,
        category -> TokenCategoryMapping,
        reply_count -> Int4,
        #[max_length = 255]
        web_link -> Nullable<Varchar>,
        #[max_length = 255]
        telegram_link -> Nullable<Varchar>,
        #[max_length = 255]
        twitter_link -> Nullable<Varchar>,
        launched_at -> Nullable<Timestamptz>,
        created_at -> Timestamptz,
        updated_at -> Timestamptz,
    }
}

diesel::table! {
    use diesel::sql_types::*;
    use super::sql_types::TradeTypeMapping;

    trades (id) {
        id -> Int4,
        token_id -> Int4,
        swapper_id -> Int4,
        trade_type -> TradeTypeMapping,
        eth_amount -> Numeric,
        token_amount -> Numeric,
        token_price -> Numeric,
        eth_price -> Numeric,
        #[max_length = 66]
        tx_hash -> Varchar,
        traded_at -> Int8,
        created_at -> Timestamptz,
        log_index -> Int8,
    }
}

diesel::table! {
    users (id) {
        id -> Int4,
        #[max_length = 50]
        address -> Varchar,
        #[max_length = 255]
        username -> Nullable<Varchar>,
        #[max_length = 255]
        avatar -> Nullable<Varchar>,
        bio -> Nullable<Text>,
        likes -> Int4,
        #[max_length = 64]
        twitter_id -> Nullable<Varchar>,
        #[max_length = 64]
        twitter_name -> Nullable<Varchar>,
        #[max_length = 64]
        twitter_username -> Nullable<Varchar>,
        #[max_length = 100]
        twitter_access -> Nullable<Varchar>,
        #[max_length = 200]
        twitter_profile_picture -> Nullable<Varchar>,
        twitter_verified -> Bool,
        created_at -> Timestamptz,
        updated_at -> Timestamptz,
    }
}

diesel::joinable!(admins -> users (user_id));
diesel::joinable!(chats -> tokens (token_id));
diesel::joinable!(chats -> users (author_id));
diesel::joinable!(holders -> tokens (token_id));
diesel::joinable!(holders -> users (user_id));
diesel::joinable!(kings -> tokens (token_id));
diesel::joinable!(referral_info -> users (user_id));
diesel::joinable!(tokens -> users (creator_id));
diesel::joinable!(trades -> tokens (token_id));
diesel::joinable!(trades -> users (swapper_id));

diesel::allow_tables_to_appear_in_same_query!(
    admins,
    chats,
    follows,
    holders,
    indexing_state,
    kings,
    referral_info,
    referrals,
    token_creation_requests,
    tokens,
    trades,
    users,
);
