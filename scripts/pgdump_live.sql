--
-- PostgreSQL database dump
--

\restrict BXSJr4HnKduMYjchadszhz9hYU1ryUTx6Lx54hDOpWyzBwsRvLHKw7PKjh9C0Ne

-- Dumped from database version 17.10
-- Dumped by pg_dump version 17.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER TABLE IF EXISTS ONLY public.watchlist DROP CONSTRAINT IF EXISTS watchlist_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.watchlist DROP CONSTRAINT IF EXISTS watchlist_token_id_fkey;
ALTER TABLE IF EXISTS ONLY public.trades DROP CONSTRAINT IF EXISTS trades_token_id_fkey;
ALTER TABLE IF EXISTS ONLY public.trades DROP CONSTRAINT IF EXISTS trades_swapper_id_fkey;
ALTER TABLE IF EXISTS ONLY public.tokens DROP CONSTRAINT IF EXISTS tokens_creator_id_fkey;
ALTER TABLE IF EXISTS ONLY public.referrals DROP CONSTRAINT IF EXISTS referrals_referrer_id_fkey;
ALTER TABLE IF EXISTS ONLY public.referrals DROP CONSTRAINT IF EXISTS referrals_referee_id_fkey;
ALTER TABLE IF EXISTS ONLY public.referral_info DROP CONSTRAINT IF EXISTS referral_info_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.points_ledger DROP CONSTRAINT IF EXISTS points_ledger_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.paper_positions DROP CONSTRAINT IF EXISTS paper_positions_token_id_fkey;
ALTER TABLE IF EXISTS ONLY public.kings DROP CONSTRAINT IF EXISTS kings_token_id_fkey;
ALTER TABLE IF EXISTS ONLY public.holders DROP CONSTRAINT IF EXISTS holders_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.holders DROP CONSTRAINT IF EXISTS holders_token_id_fkey;
ALTER TABLE IF EXISTS ONLY public.follows DROP CONSTRAINT IF EXISTS follows_follower_id_fkey;
ALTER TABLE IF EXISTS ONLY public.follows DROP CONSTRAINT IF EXISTS follows_followee_id_fkey;
ALTER TABLE IF EXISTS ONLY public.chats DROP CONSTRAINT IF EXISTS chats_token_id_fkey;
ALTER TABLE IF EXISTS ONLY public.chats DROP CONSTRAINT IF EXISTS chats_parent_id_fkey;
ALTER TABLE IF EXISTS ONLY public.chats DROP CONSTRAINT IF EXISTS chats_author_id_fkey;
ALTER TABLE IF EXISTS ONLY public.admins DROP CONSTRAINT IF EXISTS admins_user_id_fkey;
DROP TRIGGER IF EXISTS users_updated_at ON public.users;
DROP TRIGGER IF EXISTS tokens_updated_at ON public.tokens;
DROP TRIGGER IF EXISTS indexing_updated_at ON public.indexing_state;
DROP INDEX IF EXISTS public.trades_txhash_logindex_key;
DROP INDEX IF EXISTS public.idx_watchlist_user;
DROP INDEX IF EXISTS public.idx_trades_traded_at;
DROP INDEX IF EXISTS public.idx_trades_token;
DROP INDEX IF EXISTS public.idx_trades_swapper;
DROP INDEX IF EXISTS public.idx_tokens_score;
DROP INDEX IF EXISTS public.idx_tokens_network;
DROP INDEX IF EXISTS public.idx_tokens_marketcap;
DROP INDEX IF EXISTS public.idx_tokens_creator;
DROP INDEX IF EXISTS public.idx_tokens_created;
DROP INDEX IF EXISTS public.idx_points_ledger_user;
DROP INDEX IF EXISTS public.idx_paper_positions_address;
DROP INDEX IF EXISTS public.idx_holders_user;
DROP INDEX IF EXISTS public.idx_holders_token;
DROP INDEX IF EXISTS public.idx_follows_follower;
DROP INDEX IF EXISTS public.idx_follows_followee;
DROP INDEX IF EXISTS public.idx_chats_token;
ALTER TABLE IF EXISTS ONLY public.watchlist DROP CONSTRAINT IF EXISTS watchlist_user_id_token_id_key;
ALTER TABLE IF EXISTS ONLY public.watchlist DROP CONSTRAINT IF EXISTS watchlist_pkey;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_pkey;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_address_key;
ALTER TABLE IF EXISTS ONLY public.trades DROP CONSTRAINT IF EXISTS trades_pkey;
ALTER TABLE IF EXISTS ONLY public.tokens DROP CONSTRAINT IF EXISTS tokens_token_address_key;
ALTER TABLE IF EXISTS ONLY public.tokens DROP CONSTRAINT IF EXISTS tokens_pkey;
ALTER TABLE IF EXISTS ONLY public.token_creation_requests DROP CONSTRAINT IF EXISTS token_creation_requests_pkey;
ALTER TABLE IF EXISTS ONLY public.referrals DROP CONSTRAINT IF EXISTS referrals_referrer_id_referee_id_key;
ALTER TABLE IF EXISTS ONLY public.referrals DROP CONSTRAINT IF EXISTS referrals_referee_unique;
ALTER TABLE IF EXISTS ONLY public.referrals DROP CONSTRAINT IF EXISTS referrals_pkey;
ALTER TABLE IF EXISTS ONLY public.referral_info DROP CONSTRAINT IF EXISTS referral_info_user_id_key;
ALTER TABLE IF EXISTS ONLY public.referral_info DROP CONSTRAINT IF EXISTS referral_info_referral_code_key;
ALTER TABLE IF EXISTS ONLY public.referral_info DROP CONSTRAINT IF EXISTS referral_info_pkey;
ALTER TABLE IF EXISTS ONLY public.points_ledger DROP CONSTRAINT IF EXISTS points_ledger_ref_key;
ALTER TABLE IF EXISTS ONLY public.points_ledger DROP CONSTRAINT IF EXISTS points_ledger_pkey;
ALTER TABLE IF EXISTS ONLY public.paper_positions DROP CONSTRAINT IF EXISTS paper_positions_pkey;
ALTER TABLE IF EXISTS ONLY public.paper_positions DROP CONSTRAINT IF EXISTS paper_positions_address_token_id_key;
ALTER TABLE IF EXISTS ONLY public.paper_accounts DROP CONSTRAINT IF EXISTS paper_accounts_pkey;
ALTER TABLE IF EXISTS ONLY public.kings DROP CONSTRAINT IF EXISTS kings_pkey;
ALTER TABLE IF EXISTS ONLY public.indexing_state DROP CONSTRAINT IF EXISTS indexing_state_pkey;
ALTER TABLE IF EXISTS ONLY public.indexing_state DROP CONSTRAINT IF EXISTS indexing_state_network_key;
ALTER TABLE IF EXISTS ONLY public.holders DROP CONSTRAINT IF EXISTS holders_token_id_user_id_key;
ALTER TABLE IF EXISTS ONLY public.holders DROP CONSTRAINT IF EXISTS holders_pkey;
ALTER TABLE IF EXISTS ONLY public.follows DROP CONSTRAINT IF EXISTS follows_pkey;
ALTER TABLE IF EXISTS ONLY public.follows DROP CONSTRAINT IF EXISTS follows_follower_id_followee_id_key;
ALTER TABLE IF EXISTS ONLY public.distributor_rounds DROP CONSTRAINT IF EXISTS distributor_rounds_round_id_key;
ALTER TABLE IF EXISTS ONLY public.distributor_rounds DROP CONSTRAINT IF EXISTS distributor_rounds_pkey;
ALTER TABLE IF EXISTS ONLY public.chats DROP CONSTRAINT IF EXISTS chats_pkey;
ALTER TABLE IF EXISTS ONLY public.admins DROP CONSTRAINT IF EXISTS admins_user_id_key;
ALTER TABLE IF EXISTS ONLY public.admins DROP CONSTRAINT IF EXISTS admins_pkey;
ALTER TABLE IF EXISTS public.watchlist ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.users ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.trades ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.tokens ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.token_creation_requests ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.referrals ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.referral_info ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.points_ledger ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.paper_positions ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.kings ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.indexing_state ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.holders ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.follows ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.distributor_rounds ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.chats ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.admins ALTER COLUMN id DROP DEFAULT;
DROP SEQUENCE IF EXISTS public.watchlist_id_seq;
DROP TABLE IF EXISTS public.watchlist;
DROP SEQUENCE IF EXISTS public.users_id_seq;
DROP TABLE IF EXISTS public.users;
DROP SEQUENCE IF EXISTS public.trades_id_seq;
DROP TABLE IF EXISTS public.trades;
DROP SEQUENCE IF EXISTS public.tokens_id_seq;
DROP TABLE IF EXISTS public.tokens;
DROP SEQUENCE IF EXISTS public.token_creation_requests_id_seq;
DROP TABLE IF EXISTS public.token_creation_requests;
DROP SEQUENCE IF EXISTS public.referrals_id_seq;
DROP TABLE IF EXISTS public.referrals;
DROP SEQUENCE IF EXISTS public.referral_info_id_seq;
DROP TABLE IF EXISTS public.referral_info;
DROP SEQUENCE IF EXISTS public.points_ledger_id_seq;
DROP TABLE IF EXISTS public.points_ledger;
DROP SEQUENCE IF EXISTS public.paper_positions_id_seq;
DROP TABLE IF EXISTS public.paper_positions;
DROP TABLE IF EXISTS public.paper_accounts;
DROP SEQUENCE IF EXISTS public.kings_id_seq;
DROP TABLE IF EXISTS public.kings;
DROP SEQUENCE IF EXISTS public.indexing_state_id_seq;
DROP TABLE IF EXISTS public.indexing_state;
DROP SEQUENCE IF EXISTS public.holders_id_seq;
DROP TABLE IF EXISTS public.holders;
DROP SEQUENCE IF EXISTS public.follows_id_seq;
DROP TABLE IF EXISTS public.follows;
DROP SEQUENCE IF EXISTS public.distributor_rounds_id_seq;
DROP TABLE IF EXISTS public.distributor_rounds;
DROP SEQUENCE IF EXISTS public.chats_id_seq;
DROP TABLE IF EXISTS public.chats;
DROP SEQUENCE IF EXISTS public.admins_id_seq;
DROP TABLE IF EXISTS public.admins;
DROP FUNCTION IF EXISTS public.update_updated_at();
DROP TYPE IF EXISTS public.trade_type;
DROP TYPE IF EXISTS public.token_category;
DROP TYPE IF EXISTS public.pool_type;
--
-- Name: pool_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.pool_type AS ENUM (
    'v2',
    'v3',
    'v4',
    'direct'
);


ALTER TYPE public.pool_type OWNER TO postgres;

--
-- Name: token_category; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.token_category AS ENUM (
    'normal',
    'nsfw'
);


ALTER TYPE public.token_category OWNER TO postgres;

--
-- Name: trade_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.trade_type AS ENUM (
    'buy',
    'sell'
);


ALTER TYPE public.trade_type OWNER TO postgres;

--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admins; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.admins (
    id integer NOT NULL,
    user_id integer NOT NULL,
    penalized boolean DEFAULT false NOT NULL
);


ALTER TABLE public.admins OWNER TO postgres;

--
-- Name: admins_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.admins_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.admins_id_seq OWNER TO postgres;

--
-- Name: admins_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.admins_id_seq OWNED BY public.admins.id;


--
-- Name: chats; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chats (
    id integer NOT NULL,
    token_id integer NOT NULL,
    author_id integer NOT NULL,
    parent_id integer,
    content text NOT NULL,
    code character varying(255),
    network character varying(50) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.chats OWNER TO postgres;

--
-- Name: chats_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.chats_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.chats_id_seq OWNER TO postgres;

--
-- Name: chats_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.chats_id_seq OWNED BY public.chats.id;


--
-- Name: distributor_rounds; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.distributor_rounds (
    id integer NOT NULL,
    round_id bigint NOT NULL,
    time_start bigint NOT NULL,
    time_end bigint NOT NULL,
    tx_hash text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.distributor_rounds OWNER TO postgres;

--
-- Name: distributor_rounds_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.distributor_rounds_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.distributor_rounds_id_seq OWNER TO postgres;

--
-- Name: distributor_rounds_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.distributor_rounds_id_seq OWNED BY public.distributor_rounds.id;


--
-- Name: follows; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.follows (
    id integer NOT NULL,
    follower_id integer NOT NULL,
    followee_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.follows OWNER TO postgres;

--
-- Name: follows_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.follows_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.follows_id_seq OWNER TO postgres;

--
-- Name: follows_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.follows_id_seq OWNED BY public.follows.id;


--
-- Name: holders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.holders (
    id integer NOT NULL,
    token_id integer NOT NULL,
    user_id integer NOT NULL,
    amount numeric(78,18) DEFAULT 0 NOT NULL
);


ALTER TABLE public.holders OWNER TO postgres;

--
-- Name: holders_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.holders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.holders_id_seq OWNER TO postgres;

--
-- Name: holders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.holders_id_seq OWNED BY public.holders.id;


--
-- Name: indexing_state; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.indexing_state (
    id integer NOT NULL,
    network character varying(50) NOT NULL,
    last_block bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.indexing_state OWNER TO postgres;

--
-- Name: indexing_state_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.indexing_state_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.indexing_state_id_seq OWNER TO postgres;

--
-- Name: indexing_state_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.indexing_state_id_seq OWNED BY public.indexing_state.id;


--
-- Name: kings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.kings (
    id integer NOT NULL,
    token_id integer NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone
);


ALTER TABLE public.kings OWNER TO postgres;

--
-- Name: kings_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.kings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.kings_id_seq OWNER TO postgres;

--
-- Name: kings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.kings_id_seq OWNED BY public.kings.id;


--
-- Name: paper_accounts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.paper_accounts (
    address character varying(50) NOT NULL,
    eth_balance numeric(78,18) DEFAULT 10 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.paper_accounts OWNER TO postgres;

--
-- Name: paper_positions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.paper_positions (
    id integer NOT NULL,
    address character varying(50) NOT NULL,
    token_id integer NOT NULL,
    token_amount numeric(78,18) DEFAULT 0 NOT NULL,
    invested_eth numeric(78,18) DEFAULT 0 NOT NULL,
    realized_pnl_eth numeric(78,18) DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.paper_positions OWNER TO postgres;

--
-- Name: paper_positions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.paper_positions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.paper_positions_id_seq OWNER TO postgres;

--
-- Name: paper_positions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.paper_positions_id_seq OWNED BY public.paper_positions.id;


--
-- Name: points_ledger; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.points_ledger (
    id integer NOT NULL,
    user_id integer NOT NULL,
    source character varying(20) NOT NULL,
    amount double precision NOT NULL,
    ref character varying(120) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.points_ledger OWNER TO postgres;

--
-- Name: points_ledger_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.points_ledger_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.points_ledger_id_seq OWNER TO postgres;

--
-- Name: points_ledger_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.points_ledger_id_seq OWNED BY public.points_ledger.id;


--
-- Name: referral_info; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.referral_info (
    id integer NOT NULL,
    user_id integer NOT NULL,
    referral_code character varying(10) NOT NULL,
    earnings integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.referral_info OWNER TO postgres;

--
-- Name: referral_info_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.referral_info_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.referral_info_id_seq OWNER TO postgres;

--
-- Name: referral_info_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.referral_info_id_seq OWNED BY public.referral_info.id;


--
-- Name: referrals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.referrals (
    id integer NOT NULL,
    referrer_id integer NOT NULL,
    referee_id integer NOT NULL
);


ALTER TABLE public.referrals OWNER TO postgres;

--
-- Name: referrals_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.referrals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.referrals_id_seq OWNER TO postgres;

--
-- Name: referrals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.referrals_id_seq OWNED BY public.referrals.id;


--
-- Name: token_creation_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.token_creation_requests (
    id integer NOT NULL,
    creator_address character varying(50) NOT NULL,
    body jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.token_creation_requests OWNER TO postgres;

--
-- Name: token_creation_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.token_creation_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.token_creation_requests_id_seq OWNER TO postgres;

--
-- Name: token_creation_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.token_creation_requests_id_seq OWNED BY public.token_creation_requests.id;


--
-- Name: tokens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tokens (
    id integer NOT NULL,
    token_address character varying(50) NOT NULL,
    name character varying(60) NOT NULL,
    symbol character varying(30) NOT NULL,
    description text,
    image character varying(255),
    banner character varying(255),
    creator_id integer NOT NULL,
    network character varying(50) NOT NULL,
    marketcap numeric(78,18) DEFAULT 0 NOT NULL,
    price numeric(78,18) DEFAULT 0 NOT NULL,
    eth_price numeric(78,18) DEFAULT 0 NOT NULL,
    volume numeric(78,18) DEFAULT 0 NOT NULL,
    score numeric(78,18) DEFAULT 0 NOT NULL,
    virtual_eth_amount numeric(78,18) DEFAULT 0 NOT NULL,
    virtual_token_amount numeric(78,18) DEFAULT 0 NOT NULL,
    pair_address character varying(50),
    pool_type public.pool_type DEFAULT 'v2'::public.pool_type NOT NULL,
    category public.token_category DEFAULT 'normal'::public.token_category NOT NULL,
    reply_count integer DEFAULT 0 NOT NULL,
    web_link character varying(255),
    telegram_link character varying(255),
    twitter_link character varying(255),
    launched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_live boolean DEFAULT false NOT NULL,
    stream_started_at timestamp with time zone,
    image_style character varying(200)
);


ALTER TABLE public.tokens OWNER TO postgres;

--
-- Name: tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tokens_id_seq OWNER TO postgres;

--
-- Name: tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.tokens_id_seq OWNED BY public.tokens.id;


--
-- Name: trades; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.trades (
    id integer NOT NULL,
    token_id integer NOT NULL,
    swapper_id integer NOT NULL,
    trade_type public.trade_type NOT NULL,
    eth_amount numeric(78,18) NOT NULL,
    token_amount numeric(78,18) NOT NULL,
    token_price numeric(78,18) DEFAULT 0 NOT NULL,
    eth_price numeric(78,18) DEFAULT 0 NOT NULL,
    tx_hash character varying(66) NOT NULL,
    traded_at bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    log_index bigint DEFAULT 0 NOT NULL
);


ALTER TABLE public.trades OWNER TO postgres;

--
-- Name: trades_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.trades_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.trades_id_seq OWNER TO postgres;

--
-- Name: trades_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.trades_id_seq OWNED BY public.trades.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id integer NOT NULL,
    address character varying(50) NOT NULL,
    username character varying(255),
    avatar character varying(255),
    bio text,
    likes integer DEFAULT 0 NOT NULL,
    twitter_id character varying(64),
    twitter_name character varying(64),
    twitter_username character varying(64),
    twitter_access character varying(100),
    twitter_profile_picture character varying(200),
    twitter_verified boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: watchlist; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.watchlist (
    id integer NOT NULL,
    user_id integer NOT NULL,
    token_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.watchlist OWNER TO postgres;

--
-- Name: watchlist_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.watchlist_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.watchlist_id_seq OWNER TO postgres;

--
-- Name: watchlist_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.watchlist_id_seq OWNED BY public.watchlist.id;


--
-- Name: admins id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admins ALTER COLUMN id SET DEFAULT nextval('public.admins_id_seq'::regclass);


--
-- Name: chats id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chats ALTER COLUMN id SET DEFAULT nextval('public.chats_id_seq'::regclass);


--
-- Name: distributor_rounds id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.distributor_rounds ALTER COLUMN id SET DEFAULT nextval('public.distributor_rounds_id_seq'::regclass);


--
-- Name: follows id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.follows ALTER COLUMN id SET DEFAULT nextval('public.follows_id_seq'::regclass);


--
-- Name: holders id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.holders ALTER COLUMN id SET DEFAULT nextval('public.holders_id_seq'::regclass);


--
-- Name: indexing_state id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.indexing_state ALTER COLUMN id SET DEFAULT nextval('public.indexing_state_id_seq'::regclass);


--
-- Name: kings id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.kings ALTER COLUMN id SET DEFAULT nextval('public.kings_id_seq'::regclass);


--
-- Name: paper_positions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.paper_positions ALTER COLUMN id SET DEFAULT nextval('public.paper_positions_id_seq'::regclass);


--
-- Name: points_ledger id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.points_ledger ALTER COLUMN id SET DEFAULT nextval('public.points_ledger_id_seq'::regclass);


--
-- Name: referral_info id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.referral_info ALTER COLUMN id SET DEFAULT nextval('public.referral_info_id_seq'::regclass);


--
-- Name: referrals id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.referrals ALTER COLUMN id SET DEFAULT nextval('public.referrals_id_seq'::regclass);


--
-- Name: token_creation_requests id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.token_creation_requests ALTER COLUMN id SET DEFAULT nextval('public.token_creation_requests_id_seq'::regclass);


--
-- Name: tokens id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tokens ALTER COLUMN id SET DEFAULT nextval('public.tokens_id_seq'::regclass);


--
-- Name: trades id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.trades ALTER COLUMN id SET DEFAULT nextval('public.trades_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: watchlist id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.watchlist ALTER COLUMN id SET DEFAULT nextval('public.watchlist_id_seq'::regclass);


--
-- Data for Name: admins; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.admins (id, user_id, penalized) FROM stdin;
\.


--
-- Data for Name: chats; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.chats (id, token_id, author_id, parent_id, content, code, network, created_at) FROM stdin;
\.


--
-- Data for Name: distributor_rounds; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.distributor_rounds (id, round_id, time_start, time_end, tx_hash, created_at) FROM stdin;
\.


--
-- Data for Name: follows; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.follows (id, follower_id, followee_id, created_at) FROM stdin;
\.


--
-- Data for Name: holders; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.holders (id, token_id, user_id, amount) FROM stdin;
1	1	1	12875.845489854121748978
2	2	1	270327.877374901524815745
3	2	2	12869.358554813030541639
4	4	6	1286056.731921693967239312
5	4	2	1282977.585715975625737542
\.


--
-- Data for Name: indexing_state; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.indexing_state (id, network, last_block, updated_at) FROM stdin;
1	bsc	120099065	2026-07-19 19:35:23.253525+00
\.


--
-- Data for Name: kings; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.kings (id, token_id, started_at, ended_at) FROM stdin;
1	1	2026-07-17 22:27:18.027702+00	2026-07-17 23:31:39.847731+00
2	2	2026-07-17 23:31:39.847731+00	2026-07-19 16:41:05.943657+00
3	3	2026-07-19 16:41:05.943657+00	2026-07-19 16:42:21.508504+00
4	4	2026-07-19 16:42:21.508504+00	\N
\.


--
-- Data for Name: paper_accounts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.paper_accounts (address, eth_balance, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: paper_positions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.paper_positions (id, address, token_id, token_amount, invested_eth, realized_pnl_eth, updated_at) FROM stdin;
\.


--
-- Data for Name: points_ledger; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.points_ledger (id, user_id, source, amount, ref, created_at) FROM stdin;
1	1	achievement	10	ach:creator	2026-07-17 22:28:29.827024+00
2	1	quest	3	quest:daily_trade:2026-07-17	2026-07-17 22:28:35.098091+00
4	1	quest	20	quest:launch_token	2026-07-17 22:28:36.060898+00
6	1	quest	5	quest:first_buy	2026-07-17 22:28:36.639782+00
\.


--
-- Data for Name: referral_info; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.referral_info (id, user_id, referral_code, earnings) FROM stdin;
1	1	1c774298	0
2	2	6cdc3264	0
3	3	0ec80059	0
4	4	d262705f	0
5	6	6a83280a	0
\.


--
-- Data for Name: referrals; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.referrals (id, referrer_id, referee_id) FROM stdin;
1	2	4
\.


--
-- Data for Name: token_creation_requests; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.token_creation_requests (id, creator_address, body, created_at) FROM stdin;
\.


--
-- Data for Name: tokens; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.tokens (id, token_address, name, symbol, description, image, banner, creator_id, network, marketcap, price, eth_price, volume, score, virtual_eth_amount, virtual_token_amount, pair_address, pool_type, category, reply_count, web_link, telegram_link, twitter_link, launched_at, created_at, updated_at, is_live, stream_started_at, image_style) FROM stdin;
1	0xd082da137297ce5a3e81ac6b502b00eb056d3960	Gogetta	Gogetta	Ancient mythology (Greek/Norse)	https://fyuz-s3.host-ia.online/51b4cc2e-f12a-43c8-9208-0dead5d02541.png	\N	1	bsc	4363.213162039025500000	0.000000007688907736	567.468528900000000000	1.181352879559933000	0.486528609348892970	8.250098999540005520	1072987124.154510145878251022	\N	v2	normal	0				\N	2026-07-17 22:27:18.021815+00	2026-07-17 23:53:54.338586+00	f	\N	Ancient mythology (Greek/Norse)
2	0x01e9b720fe6a8a1e24759f9baf508485ea1e24f1	Goki	Goki	Cartoon Network style	https://fyuz-s3.host-ia.online/51b4cc2e-f12a-43c8-9208-0dead5d02541.png	\N	1	bsc	4365.412472159135000000	0.000000007692783387	567.468528900000000000	1.235666735879529000	1.171221296650400300	8.252177999259195572	1072716802.764070285444642616	\N	v3	normal	0				\N	2026-07-17 23:27:35.559541+00	2026-07-18 00:54:09.138299+00	f	\N	Cartoon Network style
3	0x3b71892529cdf8332e7d48b9921319a9f611d842	V	V	Steampunk	https://fyuz-s3.host-ia.online/e1af82e7-a001-4e4c-8132-4df0a22ef142.png	\N	2	bsc	4380.359541801024500000	0.000000007688723206	569.712216769999900000	0.000000000000000000	0.000000000000000000	8.250000000000000000	1073000000.000000000000000000	\N	v2	normal	0				\N	2026-07-19 16:41:05.936206+00	2026-07-19 16:41:05.936206+00	f	\N	Steampunk
4	0x3c50408f5df7bffce6c15107d9e65a7a43223eab	BenyaTrump	Bump	Post-apocalyptic wasteland	https://fyuz-s3.host-ia.online/0b994902-3c0e-4b68-8760-0cc0fb139fea.png	\N	6	bsc	4401.410498472631000000	0.000000007725673364	569.712216770000000000	11.293830141634079000	11.204729656754184000	8.269799999573024741	1070430965.682362330407023146	\N	v2	normal	0				\N	2026-07-19 16:42:21.495914+00	2026-07-19 17:00:00.450774+00	f	\N	Post-apocalyptic wasteland
\.


--
-- Data for Name: trades; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.trades (id, token_id, swapper_id, trade_type, eth_amount, token_amount, token_price, eth_price, tx_hash, traded_at, created_at, log_index) FROM stdin;
1	1	1	buy	0.000990000000000000	128744.550653921529416470	0.000000007690568610	568.728875820000000000	0x559f7ab1962b0fa5bbfb3d5e57f442d114afc0af362645f4fa4d609e2305181e	1784327257	2026-07-17 22:27:39.850933+00	1
2	1	1	sell	0.000245047051588453	32186.137663480382354117	0.000000007690107196	568.728875820000000000	0x235779f538e35a1a581663d1e608e830210e4d25091268ed312c7a1fe1142a12	1784327279	2026-07-17 22:28:01.955475+00	1
3	2	1	buy	0.000990000000000000	128744.550653921529416470	0.000000007690568610	567.048488020000000000	0xd2856d102a2c7ae11e3ce6a128f3dce1ae8966b8406ade6f21172ed71cbd14e9	1784330882	2026-07-17 23:28:05.55824+00	1
4	2	1	buy	0.000990000000000000	128713.659375671368288080	0.000000007692414235	567.468528900000000000	0x1a5871568f9243a552f85e52ac8396c2da874655715f19efe31931e78a6a4373	1784331030	2026-07-17 23:30:32.156532+00	2
5	1	1	sell	0.000735052948411547	96558.412990441147062353	0.000000007688723205	567.468528900000000000	0xd31d435a7577871878b92b1f9427aeed8d6c3c0fcdac585b162973c8db8591a1	1784331097	2026-07-17 23:31:39.840319+00	44
6	1	1	buy	0.000099000000000000	12875.845489854121748978	0.000000007688907736	567.468528900000000000	0xb06258f2ce29a44b00a78789f912a8f9851db8131b026a0d9ab9999264c7fe81	1784331183	2026-07-17 23:33:06.281596+00	13
7	2	1	buy	0.000099000000000000	12869.667345308627111195	0.000000007692598810	567.468528900000000000	0xa5d925bd5e57d3d410d6e626da5823c04d2727afb2c6b9bffed5af66a7996130	1784331393	2026-07-17 23:36:35.51577+00	1
8	2	2	buy	0.000099000000000000	12869.358554813030541639	0.000000007692783387	567.468528900000000000	0x309c55df4db72c317aab1ec8d706ab807f9be6c22b188177b832b613c0198cfc	1784331490	2026-07-17 23:38:13.520711+00	1
9	4	6	buy	0.009900000000000000	1286056.731921693967239312	0.000000007707187213	569.712216770000000000	0xd3b76d82f1ce97524e456965bbb21470747d27719287cbb067bc3ce22c3a8819	1784479338	2026-07-19 16:42:21.501701+00	5
10	4	2	buy	0.009900000000000000	1282977.585715975625737542	0.000000007725673364	569.712216770000000000	0x0c09f4e1f1511f45c52dfe04da99f8fffebf7f1ee535b7215800f203022ccf2b	1784479581	2026-07-19 16:46:23.481673+00	2
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, address, username, avatar, bio, likes, twitter_id, twitter_name, twitter_username, twitter_access, twitter_profile_picture, twitter_verified, created_at, updated_at) FROM stdin;
3	0x0ec80059f214d4128ab83c0218c2275400821b83				0	\N	\N	\N	\N	\N	f	2026-07-17 23:40:22.36149+00	2026-07-17 23:40:22.36149+00
2	0x6cdc32646528a7808a1c772f49b7487322c738a2	Test	https://fyuz-s3.host-ia.online/avatar-d9e30622-d8df-4bf6-8ca6-cf93c69ad057.png	Test	0	\N	\N	\N	\N	\N	f	2026-07-17 23:38:00.134696+00	2026-07-17 23:53:54.366486+00
5	0x0f87cadcadb0d6a16c6c3d69e76bd471086d9ce4	Test 2	https://fyuz-s3.host-ia.online/avatar-df3e5ec8-8bbb-4dbd-a4c3-e9123f3dac72.png	Test 2	0	\N	\N	\N	\N	\N	f	2026-07-17 23:43:36.107206+00	2026-07-17 23:53:54.366486+00
1	0x1c774298baea6b0a9a952b67f89d69866f010b04	Nkt	https://fyuz-s3.host-ia.online/avatar-92bd7bce-45a5-40a3-b274-dd55f5176651.png	DEV	0	\N	\N	Vitalik	\N	\N	f	2026-07-17 22:27:18.016884+00	2026-07-17 23:53:54.366486+00
4	0xd262705ffe8dd445a8efbb89d36cda5239f087d1	Robin	https://fyuz-s3.host-ia.online/avatar-584285a5-b13a-48bd-98bd-c4418ebdf785.png	Robin	0	\N	\N	\N	\N	\N	f	2026-07-17 23:41:26.327676+00	2026-07-17 23:53:54.366486+00
6	0x6a83280ac59f4f2cd355f1de8f99e351f8212506				0	\N	\N	\N	\N	\N	f	2026-07-19 16:39:18.91597+00	2026-07-19 16:39:18.91597+00
\.


--
-- Data for Name: watchlist; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.watchlist (id, user_id, token_id, created_at) FROM stdin;
1	1	1	2026-07-17 22:29:16.410731+00
3	1	2	2026-07-18 01:06:06.604017+00
\.


--
-- Name: admins_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.admins_id_seq', 1, false);


--
-- Name: chats_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.chats_id_seq', 1, false);


--
-- Name: distributor_rounds_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.distributor_rounds_id_seq', 1, false);


--
-- Name: follows_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.follows_id_seq', 1, false);


--
-- Name: holders_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.holders_id_seq', 5, true);


--
-- Name: indexing_state_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.indexing_state_id_seq', 1, true);


--
-- Name: kings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.kings_id_seq', 4, true);


--
-- Name: paper_positions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.paper_positions_id_seq', 1, false);


--
-- Name: points_ledger_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.points_ledger_id_seq', 48, true);


--
-- Name: referral_info_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.referral_info_id_seq', 5, true);


--
-- Name: referrals_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.referrals_id_seq', 1, true);


--
-- Name: token_creation_requests_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.token_creation_requests_id_seq', 4, true);


--
-- Name: tokens_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.tokens_id_seq', 4, true);


--
-- Name: trades_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.trades_id_seq', 10, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.users_id_seq', 6, true);


--
-- Name: watchlist_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.watchlist_id_seq', 3, true);


--
-- Name: admins admins_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_pkey PRIMARY KEY (id);


--
-- Name: admins admins_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_user_id_key UNIQUE (user_id);


--
-- Name: chats chats_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_pkey PRIMARY KEY (id);


--
-- Name: distributor_rounds distributor_rounds_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.distributor_rounds
    ADD CONSTRAINT distributor_rounds_pkey PRIMARY KEY (id);


--
-- Name: distributor_rounds distributor_rounds_round_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.distributor_rounds
    ADD CONSTRAINT distributor_rounds_round_id_key UNIQUE (round_id);


--
-- Name: follows follows_follower_id_followee_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_follower_id_followee_id_key UNIQUE (follower_id, followee_id);


--
-- Name: follows follows_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_pkey PRIMARY KEY (id);


--
-- Name: holders holders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.holders
    ADD CONSTRAINT holders_pkey PRIMARY KEY (id);


--
-- Name: holders holders_token_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.holders
    ADD CONSTRAINT holders_token_id_user_id_key UNIQUE (token_id, user_id);


--
-- Name: indexing_state indexing_state_network_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.indexing_state
    ADD CONSTRAINT indexing_state_network_key UNIQUE (network);


--
-- Name: indexing_state indexing_state_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.indexing_state
    ADD CONSTRAINT indexing_state_pkey PRIMARY KEY (id);


--
-- Name: kings kings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.kings
    ADD CONSTRAINT kings_pkey PRIMARY KEY (id);


--
-- Name: paper_accounts paper_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.paper_accounts
    ADD CONSTRAINT paper_accounts_pkey PRIMARY KEY (address);


--
-- Name: paper_positions paper_positions_address_token_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.paper_positions
    ADD CONSTRAINT paper_positions_address_token_id_key UNIQUE (address, token_id);


--
-- Name: paper_positions paper_positions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.paper_positions
    ADD CONSTRAINT paper_positions_pkey PRIMARY KEY (id);


--
-- Name: points_ledger points_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.points_ledger
    ADD CONSTRAINT points_ledger_pkey PRIMARY KEY (id);


--
-- Name: points_ledger points_ledger_ref_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.points_ledger
    ADD CONSTRAINT points_ledger_ref_key UNIQUE (ref);


--
-- Name: referral_info referral_info_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.referral_info
    ADD CONSTRAINT referral_info_pkey PRIMARY KEY (id);


--
-- Name: referral_info referral_info_referral_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.referral_info
    ADD CONSTRAINT referral_info_referral_code_key UNIQUE (referral_code);


--
-- Name: referral_info referral_info_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.referral_info
    ADD CONSTRAINT referral_info_user_id_key UNIQUE (user_id);


--
-- Name: referrals referrals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_pkey PRIMARY KEY (id);


--
-- Name: referrals referrals_referee_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referee_unique UNIQUE (referee_id);


--
-- Name: referrals referrals_referrer_id_referee_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referrer_id_referee_id_key UNIQUE (referrer_id, referee_id);


--
-- Name: token_creation_requests token_creation_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.token_creation_requests
    ADD CONSTRAINT token_creation_requests_pkey PRIMARY KEY (id);


--
-- Name: tokens tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tokens
    ADD CONSTRAINT tokens_pkey PRIMARY KEY (id);


--
-- Name: tokens tokens_token_address_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tokens
    ADD CONSTRAINT tokens_token_address_key UNIQUE (token_address);


--
-- Name: trades trades_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_pkey PRIMARY KEY (id);


--
-- Name: users users_address_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_address_key UNIQUE (address);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: watchlist watchlist_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.watchlist
    ADD CONSTRAINT watchlist_pkey PRIMARY KEY (id);


--
-- Name: watchlist watchlist_user_id_token_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.watchlist
    ADD CONSTRAINT watchlist_user_id_token_id_key UNIQUE (user_id, token_id);


--
-- Name: idx_chats_token; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_chats_token ON public.chats USING btree (token_id);


--
-- Name: idx_follows_followee; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_follows_followee ON public.follows USING btree (followee_id);


--
-- Name: idx_follows_follower; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_follows_follower ON public.follows USING btree (follower_id);


--
-- Name: idx_holders_token; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_holders_token ON public.holders USING btree (token_id);


--
-- Name: idx_holders_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_holders_user ON public.holders USING btree (user_id);


--
-- Name: idx_paper_positions_address; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_paper_positions_address ON public.paper_positions USING btree (address);


--
-- Name: idx_points_ledger_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_points_ledger_user ON public.points_ledger USING btree (user_id);


--
-- Name: idx_tokens_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tokens_created ON public.tokens USING btree (created_at DESC);


--
-- Name: idx_tokens_creator; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tokens_creator ON public.tokens USING btree (creator_id);


--
-- Name: idx_tokens_marketcap; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tokens_marketcap ON public.tokens USING btree (marketcap DESC);


--
-- Name: idx_tokens_network; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tokens_network ON public.tokens USING btree (network);


--
-- Name: idx_tokens_score; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tokens_score ON public.tokens USING btree (score DESC);


--
-- Name: idx_trades_swapper; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_trades_swapper ON public.trades USING btree (swapper_id);


--
-- Name: idx_trades_token; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_trades_token ON public.trades USING btree (token_id);


--
-- Name: idx_trades_traded_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_trades_traded_at ON public.trades USING btree (traded_at DESC);


--
-- Name: idx_watchlist_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_watchlist_user ON public.watchlist USING btree (user_id);


--
-- Name: trades_txhash_logindex_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX trades_txhash_logindex_key ON public.trades USING btree (tx_hash, log_index);


--
-- Name: indexing_state indexing_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER indexing_updated_at BEFORE UPDATE ON public.indexing_state FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: tokens tokens_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER tokens_updated_at BEFORE UPDATE ON public.tokens FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: users users_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: admins admins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: chats chats_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: chats chats_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.chats(id);


--
-- Name: chats chats_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(id);


--
-- Name: follows follows_followee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_followee_id_fkey FOREIGN KEY (followee_id) REFERENCES public.users(id);


--
-- Name: follows follows_follower_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES public.users(id);


--
-- Name: holders holders_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.holders
    ADD CONSTRAINT holders_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(id);


--
-- Name: holders holders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.holders
    ADD CONSTRAINT holders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: kings kings_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.kings
    ADD CONSTRAINT kings_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(id);


--
-- Name: paper_positions paper_positions_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.paper_positions
    ADD CONSTRAINT paper_positions_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(id);


--
-- Name: points_ledger points_ledger_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.points_ledger
    ADD CONSTRAINT points_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: referral_info referral_info_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.referral_info
    ADD CONSTRAINT referral_info_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: referrals referrals_referee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referee_id_fkey FOREIGN KEY (referee_id) REFERENCES public.users(id);


--
-- Name: referrals referrals_referrer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referrer_id_fkey FOREIGN KEY (referrer_id) REFERENCES public.users(id);


--
-- Name: tokens tokens_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tokens
    ADD CONSTRAINT tokens_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id);


--
-- Name: trades trades_swapper_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_swapper_id_fkey FOREIGN KEY (swapper_id) REFERENCES public.users(id);


--
-- Name: trades trades_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(id);


--
-- Name: watchlist watchlist_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.watchlist
    ADD CONSTRAINT watchlist_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.tokens(id);


--
-- Name: watchlist watchlist_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.watchlist
    ADD CONSTRAINT watchlist_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--

\unrestrict BXSJr4HnKduMYjchadszhz9hYU1ryUTx6Lx54hDOpWyzBwsRvLHKw7PKjh9C0Ne

