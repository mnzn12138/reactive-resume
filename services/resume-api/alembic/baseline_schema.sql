--
-- PostgreSQL database dump
--


-- Dumped from database version 18.6 (Debian 18.6-1.pgdg13+2)
-- Dumped by pg_dump version 18.6 (Debian 18.6-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: drizzle; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA drizzle;


ALTER SCHEMA drizzle OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: __drizzle_migrations; Type: TABLE; Schema: drizzle; Owner: postgres
--

CREATE TABLE drizzle.__drizzle_migrations (
    id integer NOT NULL,
    hash text NOT NULL,
    created_at bigint,
    name text,
    applied_at timestamp with time zone DEFAULT now()
);


ALTER TABLE drizzle.__drizzle_migrations OWNER TO postgres;

--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE; Schema: drizzle; Owner: postgres
--

CREATE SEQUENCE drizzle.__drizzle_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNER TO postgres;

--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: drizzle; Owner: postgres
--

ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNED BY drizzle.__drizzle_migrations.id;


--
-- Name: account; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.account (
    id text NOT NULL,
    account_id text NOT NULL,
    provider_id text DEFAULT 'credential'::text NOT NULL,
    user_id text NOT NULL,
    scope text,
    id_token text,
    password text,
    access_token text,
    refresh_token text,
    access_token_expires_at timestamp with time zone,
    refresh_token_expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    issuer text,
    openid text
);


ALTER TABLE public.account OWNER TO postgres;

--
-- Name: admin_audit_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.admin_audit_log (
    id text NOT NULL,
    actor_id text,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.admin_audit_log OWNER TO postgres;

--
-- Name: agent_actions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.agent_actions (
    id text NOT NULL,
    user_id text NOT NULL,
    thread_id text NOT NULL,
    message_id text,
    resume_id text,
    kind text NOT NULL,
    status text DEFAULT 'applied'::text NOT NULL,
    title text NOT NULL,
    summary text,
    operations jsonb NOT NULL,
    base_updated_at timestamp with time zone NOT NULL,
    applied_updated_at timestamp with time zone NOT NULL,
    reverted_at timestamp with time zone,
    revert_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    snapshot_data jsonb
);


ALTER TABLE public.agent_actions OWNER TO postgres;

--
-- Name: agent_attachments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.agent_attachments (
    id text NOT NULL,
    user_id text NOT NULL,
    thread_id text NOT NULL,
    message_id text,
    storage_key text NOT NULL,
    filename text NOT NULL,
    media_type text NOT NULL,
    size integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.agent_attachments OWNER TO postgres;

--
-- Name: agent_messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.agent_messages (
    id text NOT NULL,
    user_id text NOT NULL,
    thread_id text NOT NULL,
    role text NOT NULL,
    status text DEFAULT 'completed'::text NOT NULL,
    sequence integer NOT NULL,
    ui_message jsonb NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.agent_messages OWNER TO postgres;

--
-- Name: agent_threads; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.agent_threads (
    id text NOT NULL,
    user_id text NOT NULL,
    ai_provider_id text,
    source_resume_id text,
    working_resume_id text,
    title text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    active_run_id text,
    active_stream_id text,
    active_run_started_at timestamp with time zone,
    last_message_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    review_patches boolean DEFAULT false NOT NULL
);


ALTER TABLE public.agent_threads OWNER TO postgres;

--
-- Name: ai_providers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ai_providers (
    id text NOT NULL,
    user_id text NOT NULL,
    label text NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    base_url text,
    encrypted_api_key text NOT NULL,
    api_key_salt text NOT NULL,
    api_key_hash text NOT NULL,
    api_key_preview text NOT NULL,
    test_status text DEFAULT 'untested'::text NOT NULL,
    test_error text,
    last_tested_at timestamp with time zone,
    last_used_at timestamp with time zone,
    enabled boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.ai_providers OWNER TO postgres;

--
-- Name: application; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.application (
    id text NOT NULL,
    user_id text NOT NULL,
    company text NOT NULL,
    role text NOT NULL,
    location text,
    salary text,
    status text DEFAULT 'saved'::text NOT NULL,
    archived boolean DEFAULT false NOT NULL,
    resume_id text,
    source text,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    source_url text,
    job_description text,
    match_score integer,
    ai_metadata jsonb,
    notes text,
    resume_file_url text,
    resume_file_name text,
    follow_up_at timestamp with time zone,
    follow_up_note text,
    contacts jsonb DEFAULT '[]'::jsonb NOT NULL,
    activity jsonb DEFAULT '[]'::jsonb NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.application OWNER TO postgres;

--
-- Name: instance_setting; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.instance_setting (
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.instance_setting OWNER TO postgres;

--
-- Name: jwks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.jwks (
    id text NOT NULL,
    public_key text NOT NULL,
    private_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    alg text,
    crv text
);


ALTER TABLE public.jwks OWNER TO postgres;

--
-- Name: oauth_access_token; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.oauth_access_token (
    id text NOT NULL,
    token text NOT NULL,
    client_id text NOT NULL,
    session_id text,
    user_id text,
    reference_id text,
    refresh_id text,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    scopes text[] NOT NULL,
    authorization_code_id text,
    resources text[],
    requested_user_info_claims text[],
    revoked timestamp with time zone,
    confirmation jsonb
);


ALTER TABLE public.oauth_access_token OWNER TO postgres;

--
-- Name: oauth_client; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.oauth_client (
    id text NOT NULL,
    client_id text NOT NULL,
    client_secret text,
    disabled boolean DEFAULT false,
    skip_consent boolean,
    enable_end_session boolean,
    subject_type text,
    scopes text[],
    user_id text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    name text,
    uri text,
    icon text,
    contacts text[],
    tos text,
    policy text,
    software_id text,
    software_version text,
    software_statement text,
    redirect_uris text[] NOT NULL,
    post_logout_redirect_uris text[],
    token_endpoint_auth_method text,
    grant_types text[],
    response_types text[],
    public boolean,
    type text,
    require_pkce boolean,
    reference_id text,
    metadata jsonb,
    client_discovery_id text,
    client_credentials_scopes text[] DEFAULT '{}'::text[],
    backchannel_logout_uri text,
    backchannel_logout_session_required boolean,
    application_type text,
    jwks text,
    jwks_uri text,
    dpop_bound_access_tokens boolean DEFAULT false
);


ALTER TABLE public.oauth_client OWNER TO postgres;

--
-- Name: oauth_client_assertion; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.oauth_client_assertion (
    id text NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


ALTER TABLE public.oauth_client_assertion OWNER TO postgres;

--
-- Name: oauth_client_resource; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.oauth_client_resource (
    id text NOT NULL,
    client_id text NOT NULL,
    resource_id text NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone
);


ALTER TABLE public.oauth_client_resource OWNER TO postgres;

--
-- Name: oauth_consent; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.oauth_consent (
    id text NOT NULL,
    client_id text NOT NULL,
    user_id text,
    reference_id text,
    scopes text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    resources text[],
    requested_user_info_claims text[]
);


ALTER TABLE public.oauth_consent OWNER TO postgres;

--
-- Name: oauth_refresh_token; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.oauth_refresh_token (
    id text NOT NULL,
    token text NOT NULL,
    client_id text NOT NULL,
    session_id text,
    user_id text NOT NULL,
    reference_id text,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    revoked timestamp with time zone,
    auth_time timestamp with time zone,
    scopes text[] NOT NULL,
    authorization_code_id text,
    resources text[],
    requested_user_info_claims text[],
    rotated_at timestamp with time zone,
    rotation_replay_response text,
    rotation_replay_expires_at timestamp with time zone,
    confirmation jsonb
);


ALTER TABLE public.oauth_refresh_token OWNER TO postgres;

--
-- Name: oauth_resource; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.oauth_resource (
    id text NOT NULL,
    identifier text NOT NULL,
    name text NOT NULL,
    access_token_ttl integer,
    refresh_token_ttl integer,
    signing_algorithm text,
    signing_key_id text,
    allowed_scopes text[],
    custom_claims jsonb,
    dpop_bound_access_tokens_required boolean DEFAULT false,
    disabled boolean DEFAULT false,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    policy_version integer DEFAULT 1,
    metadata jsonb
);


ALTER TABLE public.oauth_resource OWNER TO postgres;

--
-- Name: passkey; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.passkey (
    id text NOT NULL,
    name text,
    aaguid text,
    public_key text NOT NULL,
    credential_id text NOT NULL,
    counter integer NOT NULL,
    device_type text NOT NULL,
    backed_up boolean DEFAULT false NOT NULL,
    transports text NOT NULL,
    user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.passkey OWNER TO postgres;

--
-- Name: resume; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.resume (
    id text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    is_public boolean DEFAULT false NOT NULL,
    is_locked boolean DEFAULT false NOT NULL,
    password text,
    data jsonb NOT NULL,
    user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    show_download_buttons boolean DEFAULT true NOT NULL
);


ALTER TABLE public.resume OWNER TO postgres;

--
-- Name: resume_statistics; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.resume_statistics (
    id text NOT NULL,
    views integer DEFAULT 0 NOT NULL,
    downloads integer DEFAULT 0 NOT NULL,
    last_viewed_at timestamp with time zone,
    last_downloaded_at timestamp with time zone,
    resume_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.resume_statistics OWNER TO postgres;

--
-- Name: resume_statistics_daily; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.resume_statistics_daily (
    id text NOT NULL,
    date date NOT NULL,
    views integer DEFAULT 0 NOT NULL,
    downloads integer DEFAULT 0 NOT NULL,
    resume_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.resume_statistics_daily OWNER TO postgres;

--
-- Name: resume_version; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.resume_version (
    id text NOT NULL,
    resume_id text NOT NULL,
    user_id text NOT NULL,
    data jsonb NOT NULL,
    label text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.resume_version OWNER TO postgres;

--
-- Name: session; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.session (
    id text NOT NULL,
    token text NOT NULL,
    ip_address text,
    user_agent text,
    user_id text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    impersonated_by text
);


ALTER TABLE public.session OWNER TO postgres;

--
-- Name: sms_send_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sms_send_log (
    id text NOT NULL,
    phone_hash text NOT NULL,
    ip_hash text,
    vendor text NOT NULL,
    result_code text NOT NULL,
    vendor_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.sms_send_log OWNER TO postgres;

--
-- Name: two_factor; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.two_factor (
    id text NOT NULL,
    user_id text NOT NULL,
    secret text NOT NULL,
    backup_codes text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    verified boolean DEFAULT true NOT NULL,
    failed_verification_count integer DEFAULT 0,
    locked_until timestamp with time zone
);


ALTER TABLE public.two_factor OWNER TO postgres;

--
-- Name: user; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."user" (
    id text NOT NULL,
    image text,
    name text NOT NULL,
    email text NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    username text NOT NULL,
    display_username text NOT NULL,
    two_factor_enabled boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_active_at timestamp with time zone,
    role text DEFAULT 'user'::text,
    banned boolean DEFAULT false,
    ban_reason text,
    ban_expires timestamp(6) with time zone,
    phone_number text,
    phone_number_verified boolean DEFAULT false NOT NULL
);


ALTER TABLE public."user" OWNER TO postgres;

--
-- Name: user_consent; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_consent (
    id text NOT NULL,
    user_id text NOT NULL,
    document text NOT NULL,
    version text NOT NULL,
    source text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.user_consent OWNER TO postgres;

--
-- Name: verification; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.verification (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.verification OWNER TO postgres;

--
-- Name: __drizzle_migrations id; Type: DEFAULT; Schema: drizzle; Owner: postgres
--

ALTER TABLE ONLY drizzle.__drizzle_migrations ALTER COLUMN id SET DEFAULT nextval('drizzle.__drizzle_migrations_id_seq'::regclass);


--
-- Name: __drizzle_migrations __drizzle_migrations_pkey; Type: CONSTRAINT; Schema: drizzle; Owner: postgres
--

ALTER TABLE ONLY drizzle.__drizzle_migrations
    ADD CONSTRAINT __drizzle_migrations_pkey PRIMARY KEY (id);


--
-- Name: account account_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);


--
-- Name: admin_audit_log admin_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_pkey PRIMARY KEY (id);


--
-- Name: agent_actions agent_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.agent_actions
    ADD CONSTRAINT agent_actions_pkey PRIMARY KEY (id);


--
-- Name: agent_attachments agent_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.agent_attachments
    ADD CONSTRAINT agent_attachments_pkey PRIMARY KEY (id);


--
-- Name: agent_messages agent_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.agent_messages
    ADD CONSTRAINT agent_messages_pkey PRIMARY KEY (id);


--
-- Name: agent_threads agent_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.agent_threads
    ADD CONSTRAINT agent_threads_pkey PRIMARY KEY (id);


--
-- Name: ai_providers ai_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_providers
    ADD CONSTRAINT ai_providers_pkey PRIMARY KEY (id);


--
-- Name: application application_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.application
    ADD CONSTRAINT application_pkey PRIMARY KEY (id);


--
-- Name: instance_setting instance_setting_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.instance_setting
    ADD CONSTRAINT instance_setting_pkey PRIMARY KEY (key);


--
-- Name: jwks jwks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.jwks
    ADD CONSTRAINT jwks_pkey PRIMARY KEY (id);


--
-- Name: oauth_access_token oauth_access_token_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oauth_access_token
    ADD CONSTRAINT oauth_access_token_pkey PRIMARY KEY (id);


--
-- Name: oauth_access_token oauth_access_token_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oauth_access_token
    ADD CONSTRAINT oauth_access_token_token_key UNIQUE (token);


--
-- Name: oauth_client_assertion oauth_client_assertion_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oauth_client_assertion
    ADD CONSTRAINT oauth_client_assertion_pkey PRIMARY KEY (id);


--
-- Name: oauth_client oauth_client_client_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oauth_client
    ADD CONSTRAINT oauth_client_client_id_key UNIQUE (client_id);


--
-- Name: oauth_client oauth_client_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oauth_client
    ADD CONSTRAINT oauth_client_pkey PRIMARY KEY (id);


--
-- Name: oauth_client_resource oauth_client_resource_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oauth_client_resource
    ADD CONSTRAINT oauth_client_resource_pkey PRIMARY KEY (id);


--
-- Name: oauth_consent oauth_consent_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oauth_consent
    ADD CONSTRAINT oauth_consent_pkey PRIMARY KEY (id);


--
-- Name: oauth_refresh_token oauth_refresh_token_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oauth_refresh_token
    ADD CONSTRAINT oauth_refresh_token_pkey PRIMARY KEY (id);


--
-- Name: oauth_resource oauth_resource_identifier_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oauth_resource
    ADD CONSTRAINT oauth_resource_identifier_key UNIQUE (identifier);


--
-- Name: oauth_resource oauth_resource_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oauth_resource
    ADD CONSTRAINT oauth_resource_pkey PRIMARY KEY (id);


--
-- Name: passkey passkey_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.passkey
    ADD CONSTRAINT passkey_pkey PRIMARY KEY (id);


--
-- Name: resume resume_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.resume
    ADD CONSTRAINT resume_pkey PRIMARY KEY (id);


--
-- Name: resume resume_slug_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.resume
    ADD CONSTRAINT resume_slug_user_id_unique UNIQUE (slug, user_id);


--
-- Name: resume_statistics_daily resume_statistics_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.resume_statistics_daily
    ADD CONSTRAINT resume_statistics_daily_pkey PRIMARY KEY (id);


--
-- Name: resume_statistics_daily resume_statistics_daily_resume_id_date_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.resume_statistics_daily
    ADD CONSTRAINT resume_statistics_daily_resume_id_date_unique UNIQUE (resume_id, date);


--
-- Name: resume_statistics resume_statistics_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.resume_statistics
    ADD CONSTRAINT resume_statistics_pkey PRIMARY KEY (id);


--
-- Name: resume_statistics resume_statistics_resume_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.resume_statistics
    ADD CONSTRAINT resume_statistics_resume_id_key UNIQUE (resume_id);


--
-- Name: resume_version resume_version_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.resume_version
    ADD CONSTRAINT resume_version_pkey PRIMARY KEY (id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);


--
-- Name: session session_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_token_key UNIQUE (token);


--
-- Name: sms_send_log sms_send_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sms_send_log
    ADD CONSTRAINT sms_send_log_pkey PRIMARY KEY (id);


--
-- Name: two_factor two_factor_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.two_factor
    ADD CONSTRAINT two_factor_pkey PRIMARY KEY (id);


--
-- Name: user_consent user_consent_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_consent
    ADD CONSTRAINT user_consent_pkey PRIMARY KEY (id);


--
-- Name: user user_display_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_display_username_key UNIQUE (display_username);


--
-- Name: user user_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_email_key UNIQUE (email);


--
-- Name: user user_phone_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_phone_number_key UNIQUE (phone_number);


--
-- Name: user user_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);


--
-- Name: user user_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_username_key UNIQUE (username);


--
-- Name: verification verification_identifier_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.verification
    ADD CONSTRAINT verification_identifier_key UNIQUE (identifier);


--
-- Name: verification verification_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);


--
-- Name: account_user_id_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX account_user_id_index ON public.account USING btree (user_id);


--
-- Name: admin_audit_log_actor_id_created_at_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX admin_audit_log_actor_id_created_at_index ON public.admin_audit_log USING btree (actor_id, created_at DESC NULLS LAST);


--
-- Name: admin_audit_log_created_at_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX admin_audit_log_created_at_index ON public.admin_audit_log USING btree (created_at DESC NULLS LAST);


--
-- Name: admin_audit_log_target_type_target_id_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX admin_audit_log_target_type_target_id_index ON public.admin_audit_log USING btree (target_type, target_id);


--
-- Name: agent_actions_message_id_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX agent_actions_message_id_index ON public.agent_actions USING btree (message_id);


--
-- Name: agent_actions_resume_id_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX agent_actions_resume_id_index ON public.agent_actions USING btree (resume_id);


--
-- Name: agent_actions_thread_id_created_at_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX agent_actions_thread_id_created_at_index ON public.agent_actions USING btree (thread_id, created_at DESC NULLS LAST);


--
-- Name: agent_attachments_message_id_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX agent_attachments_message_id_index ON public.agent_attachments USING btree (message_id);


--
-- Name: agent_attachments_thread_id_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX agent_attachments_thread_id_index ON public.agent_attachments USING btree (thread_id);


--
-- Name: agent_attachments_user_id_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX agent_attachments_user_id_index ON public.agent_attachments USING btree (user_id);


--
-- Name: agent_messages_thread_id_sequence_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX agent_messages_thread_id_sequence_index ON public.agent_messages USING btree (thread_id, sequence);


--
-- Name: agent_messages_user_id_created_at_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX agent_messages_user_id_created_at_index ON public.agent_messages USING btree (user_id, created_at DESC NULLS LAST);


--
-- Name: agent_threads_active_in_place_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX agent_threads_active_in_place_unique ON public.agent_threads USING btree (user_id, working_resume_id, source_resume_id) WHERE ((status = 'active'::text) AND (deleted_at IS NULL));


--
-- Name: agent_threads_ai_provider_id_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX agent_threads_ai_provider_id_index ON public.agent_threads USING btree (ai_provider_id);


--
-- Name: agent_threads_user_id_status_last_message_at_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX agent_threads_user_id_status_last_message_at_index ON public.agent_threads USING btree (user_id, status, last_message_at DESC NULLS LAST);


--
-- Name: agent_threads_working_resume_id_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX agent_threads_working_resume_id_index ON public.agent_threads USING btree (working_resume_id);


--
-- Name: ai_providers_user_id_created_at_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ai_providers_user_id_created_at_index ON public.ai_providers USING btree (user_id, created_at);


--
-- Name: ai_providers_user_id_enabled_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ai_providers_user_id_enabled_index ON public.ai_providers USING btree (user_id, enabled);


--
-- Name: ai_providers_user_id_last_used_at_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ai_providers_user_id_last_used_at_index ON public.ai_providers USING btree (user_id, last_used_at DESC NULLS LAST);


--
-- Name: application_user_id_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX application_user_id_index ON public.application USING btree (user_id);


--
-- Name: application_user_id_updated_at_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX application_user_id_updated_at_index ON public.application USING btree (user_id, updated_at DESC NULLS LAST);


--
-- Name: instance_setting_updated_at_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX instance_setting_updated_at_index ON public.instance_setting USING btree (updated_at DESC NULLS LAST);


--
-- Name: oauth_access_token_token_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX oauth_access_token_token_index ON public.oauth_access_token USING btree (token);


--
-- Name: oauth_client_client_id_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX oauth_client_client_id_index ON public.oauth_client USING btree (client_id);


--
-- Name: oauth_client_resource_client_id_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX oauth_client_resource_client_id_index ON public.oauth_client_resource USING btree (client_id);


--
-- Name: oauth_client_resource_client_id_resource_id_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX oauth_client_resource_client_id_resource_id_index ON public.oauth_client_resource USING btree (client_id, resource_id);


--
-- Name: oauth_client_resource_resource_id_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX oauth_client_resource_resource_id_index ON public.oauth_client_resource USING btree (resource_id);


--
-- Name: oauth_consent_user_id_client_id_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX oauth_consent_user_id_client_id_index ON public.oauth_consent USING btree (user_id, client_id);


--
-- Name: oauth_refresh_token_token_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX oauth_refresh_token_token_index ON public.oauth_refresh_token USING btree (token);


--
-- Name: passkey_user_id_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX passkey_user_id_index ON public.passkey USING btree (user_id);


--
-- Name: resume_created_at_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX resume_created_at_index ON public.resume USING btree (created_at);


--
-- Name: resume_is_public_slug_user_id_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX resume_is_public_slug_user_id_index ON public.resume USING btree (is_public, slug, user_id);


--
-- Name: resume_statistics_daily_resume_id_date_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX resume_statistics_daily_resume_id_date_index ON public.resume_statistics_daily USING btree (resume_id, date DESC NULLS LAST);


--
-- Name: resume_user_id_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX resume_user_id_index ON public.resume USING btree (user_id);


--
-- Name: resume_user_id_updated_at_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX resume_user_id_updated_at_index ON public.resume USING btree (user_id, updated_at DESC NULLS LAST);


--
-- Name: resume_version_resume_id_created_at_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX resume_version_resume_id_created_at_index ON public.resume_version USING btree (resume_id, created_at DESC NULLS LAST);


--
-- Name: session_expires_at_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX session_expires_at_index ON public.session USING btree (expires_at);


--
-- Name: session_token_user_id_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX session_token_user_id_index ON public.session USING btree (token, user_id);


--
-- Name: sms_send_log_created_at_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sms_send_log_created_at_index ON public.sms_send_log USING btree (created_at DESC NULLS LAST);


--
-- Name: sms_send_log_ip_hash_created_at_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sms_send_log_ip_hash_created_at_index ON public.sms_send_log USING btree (ip_hash, created_at DESC NULLS LAST);


--
-- Name: sms_send_log_phone_hash_created_at_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sms_send_log_phone_hash_created_at_index ON public.sms_send_log USING btree (phone_hash, created_at DESC NULLS LAST);


--
-- Name: two_factor_secret_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX two_factor_secret_index ON public.two_factor USING btree (secret);


--
-- Name: two_factor_user_id_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX two_factor_user_id_index ON public.two_factor USING btree (user_id);


--
-- Name: user_consent_user_id_created_at_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX user_consent_user_id_created_at_index ON public.user_consent USING btree (user_id, created_at DESC NULLS LAST);


--
-- Name: user_consent_user_id_document_version_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX user_consent_user_id_document_version_index ON public.user_consent USING btree (user_id, document, version);


--
-- Name: user_created_at_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX user_created_at_index ON public."user" USING btree (created_at);


--
-- Name: user_email_lower_unique_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX user_email_lower_unique_idx ON public."user" USING btree (lower(email));


--
-- Name: verification_identifier_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX verification_identifier_index ON public.verification USING btree (identifier);


--
-- Name: account account_user_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_user_id_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: admin_audit_log admin_audit_log_actor_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_actor_id_user_id_fkey FOREIGN KEY (actor_id) REFERENCES public."user"(id) ON DELETE SET NULL;


--
-- Name: agent_actions agent_actions_message_id_agent_messages_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.agent_actions
    ADD CONSTRAINT agent_actions_message_id_agent_messages_id_fkey FOREIGN KEY (message_id) REFERENCES public.agent_messages(id) ON DELETE SET NULL;


--
-- Name: agent_actions agent_actions_resume_id_resume_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.agent_actions
    ADD CONSTRAINT agent_actions_resume_id_resume_id_fkey FOREIGN KEY (resume_id) REFERENCES public.resume(id) ON DELETE SET NULL;


--
-- Name: agent_actions agent_actions_thread_id_agent_threads_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.agent_actions
    ADD CONSTRAINT agent_actions_thread_id_agent_threads_id_fkey FOREIGN KEY (thread_id) REFERENCES public.agent_threads(id) ON DELETE CASCADE;


--
-- Name: agent_actions agent_actions_user_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.agent_actions
    ADD CONSTRAINT agent_actions_user_id_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: agent_attachments agent_attachments_message_id_agent_messages_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.agent_attachments
    ADD CONSTRAINT agent_attachments_message_id_agent_messages_id_fkey FOREIGN KEY (message_id) REFERENCES public.agent_messages(id) ON DELETE SET NULL;


--
-- Name: agent_attachments agent_attachments_thread_id_agent_threads_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.agent_attachments
    ADD CONSTRAINT agent_attachments_thread_id_agent_threads_id_fkey FOREIGN KEY (thread_id) REFERENCES public.agent_threads(id) ON DELETE CASCADE;


--
-- Name: agent_attachments agent_attachments_user_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.agent_attachments
    ADD CONSTRAINT agent_attachments_user_id_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: agent_messages agent_messages_thread_id_agent_threads_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.agent_messages
    ADD CONSTRAINT agent_messages_thread_id_agent_threads_id_fkey FOREIGN KEY (thread_id) REFERENCES public.agent_threads(id) ON DELETE CASCADE;


--
-- Name: agent_messages agent_messages_user_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.agent_messages
    ADD CONSTRAINT agent_messages_user_id_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: agent_threads agent_threads_ai_provider_id_ai_providers_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.agent_threads
    ADD CONSTRAINT agent_threads_ai_provider_id_ai_providers_id_fkey FOREIGN KEY (ai_provider_id) REFERENCES public.ai_providers(id) ON DELETE SET NULL;


--
-- Name: agent_threads agent_threads_source_resume_id_resume_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.agent_threads
    ADD CONSTRAINT agent_threads_source_resume_id_resume_id_fkey FOREIGN KEY (source_resume_id) REFERENCES public.resume(id) ON DELETE SET NULL;


--
-- Name: agent_threads agent_threads_user_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.agent_threads
    ADD CONSTRAINT agent_threads_user_id_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: agent_threads agent_threads_working_resume_id_resume_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.agent_threads
    ADD CONSTRAINT agent_threads_working_resume_id_resume_id_fkey FOREIGN KEY (working_resume_id) REFERENCES public.resume(id) ON DELETE SET NULL;


--
-- Name: ai_providers ai_providers_user_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_providers
    ADD CONSTRAINT ai_providers_user_id_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: application application_resume_id_resume_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.application
    ADD CONSTRAINT application_resume_id_resume_id_fkey FOREIGN KEY (resume_id) REFERENCES public.resume(id) ON DELETE SET NULL;


--
-- Name: application application_user_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.application
    ADD CONSTRAINT application_user_id_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: instance_setting instance_setting_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.instance_setting
    ADD CONSTRAINT instance_setting_updated_by_user_id_fkey FOREIGN KEY (updated_by) REFERENCES public."user"(id) ON DELETE SET NULL;


--
-- Name: oauth_access_token oauth_access_token_client_id_oauth_client_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oauth_access_token
    ADD CONSTRAINT oauth_access_token_client_id_oauth_client_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.oauth_client(client_id) ON DELETE CASCADE;


--
-- Name: oauth_access_token oauth_access_token_refresh_id_oauth_refresh_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oauth_access_token
    ADD CONSTRAINT oauth_access_token_refresh_id_oauth_refresh_token_id_fkey FOREIGN KEY (refresh_id) REFERENCES public.oauth_refresh_token(id) ON DELETE CASCADE;


--
-- Name: oauth_access_token oauth_access_token_session_id_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oauth_access_token
    ADD CONSTRAINT oauth_access_token_session_id_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(id) ON DELETE SET NULL;


--
-- Name: oauth_access_token oauth_access_token_user_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oauth_access_token
    ADD CONSTRAINT oauth_access_token_user_id_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: oauth_client_resource oauth_client_resource_client_id_oauth_client_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oauth_client_resource
    ADD CONSTRAINT oauth_client_resource_client_id_oauth_client_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.oauth_client(client_id) ON DELETE CASCADE;


--
-- Name: oauth_client_resource oauth_client_resource_dn2L1gs9Dolm_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oauth_client_resource
    ADD CONSTRAINT "oauth_client_resource_dn2L1gs9Dolm_fkey" FOREIGN KEY (resource_id) REFERENCES public.oauth_resource(identifier) ON DELETE CASCADE;


--
-- Name: oauth_client oauth_client_user_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oauth_client
    ADD CONSTRAINT oauth_client_user_id_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: oauth_consent oauth_consent_client_id_oauth_client_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oauth_consent
    ADD CONSTRAINT oauth_consent_client_id_oauth_client_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.oauth_client(client_id) ON DELETE CASCADE;


--
-- Name: oauth_consent oauth_consent_user_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oauth_consent
    ADD CONSTRAINT oauth_consent_user_id_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: oauth_refresh_token oauth_refresh_token_client_id_oauth_client_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oauth_refresh_token
    ADD CONSTRAINT oauth_refresh_token_client_id_oauth_client_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.oauth_client(client_id) ON DELETE CASCADE;


--
-- Name: oauth_refresh_token oauth_refresh_token_session_id_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oauth_refresh_token
    ADD CONSTRAINT oauth_refresh_token_session_id_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.session(id) ON DELETE SET NULL;


--
-- Name: oauth_refresh_token oauth_refresh_token_user_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oauth_refresh_token
    ADD CONSTRAINT oauth_refresh_token_user_id_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: passkey passkey_user_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.passkey
    ADD CONSTRAINT passkey_user_id_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: resume_statistics_daily resume_statistics_daily_resume_id_resume_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.resume_statistics_daily
    ADD CONSTRAINT resume_statistics_daily_resume_id_resume_id_fkey FOREIGN KEY (resume_id) REFERENCES public.resume(id) ON DELETE CASCADE;


--
-- Name: resume_statistics resume_statistics_resume_id_resume_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.resume_statistics
    ADD CONSTRAINT resume_statistics_resume_id_resume_id_fkey FOREIGN KEY (resume_id) REFERENCES public.resume(id) ON DELETE CASCADE;


--
-- Name: resume resume_user_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.resume
    ADD CONSTRAINT resume_user_id_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: resume_version resume_version_resume_id_resume_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.resume_version
    ADD CONSTRAINT resume_version_resume_id_resume_id_fkey FOREIGN KEY (resume_id) REFERENCES public.resume(id) ON DELETE CASCADE;


--
-- Name: resume_version resume_version_user_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.resume_version
    ADD CONSTRAINT resume_version_user_id_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: session session_user_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_user_id_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: two_factor two_factor_user_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.two_factor
    ADD CONSTRAINT two_factor_user_id_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: user_consent user_consent_user_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_consent
    ADD CONSTRAINT user_consent_user_id_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


