use axum::extract::State;
use axum::Json;
use diesel::prelude::*;
use diesel_async::RunQueryDsl;
use serde::Deserialize;
use std::sync::Arc;

use crate::errors::{AppError, AppResult};
use crate::middleware::auth::verify_signed_action;
use crate::models::*;
use crate::schema::*;
use crate::AppState;

// ---------------------------------------------------------------------------
// Body types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetChatsBody {
    pub token_address: String,
    pub network: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplyBody {
    pub token_address: String,
    pub reply_address: String,
    pub comment: String,
    pub network: String,
    pub signature: String,
    pub msg: String,
    pub reply_id: Option<i32>,
}

// ---------------------------------------------------------------------------
// POST /chats
// ---------------------------------------------------------------------------

pub async fn get_chats(
    State(state): State<Arc<AppState>>,
    Json(body): Json<GetChatsBody>,
) -> AppResult<Json<Vec<ChatResponse>>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    // Find token
    let token: Token = tokens::table
        .filter(tokens::token_address.eq(&body.token_address))
        .filter(tokens::network.eq(&body.network))
        .first(&mut conn)
        .await
        .optional()?
        .ok_or_else(|| AppError::NotFound("Token not found".to_string()))?;

    // Query chats for this token, ordered by code ASC then created_at ASC
    let chat_rows: Vec<Chat> = chats::table
        .filter(chats::token_id.eq(token.id))
        .order((chats::code.asc(), chats::created_at.asc()))
        .load(&mut conn)
        .await?;

    // Collect all author_ids and parent_ids to fetch user addresses in bulk
    let author_ids: Vec<i32> = chat_rows.iter().map(|c| c.author_id).collect();
    let authors: Vec<User> = users::table
        .filter(users::id.eq_any(&author_ids))
        .load(&mut conn)
        .await?;

    let _author_map: std::collections::HashMap<i32, &User> =
        authors.iter().map(|u| (u.id, u)).collect();

    // For reply chats, look up the parent chat's author to get reply_address
    let parent_ids: Vec<i32> = chat_rows
        .iter()
        .filter_map(|c| c.parent_id)
        .collect();

    let parent_chats: Vec<Chat> = if parent_ids.is_empty() {
        vec![]
    } else {
        chats::table
            .filter(chats::id.eq_any(&parent_ids))
            .load(&mut conn)
            .await?
    };

    let parent_author_ids: Vec<i32> = parent_chats.iter().map(|c| c.author_id).collect();
    let parent_authors: Vec<User> = if parent_author_ids.is_empty() {
        vec![]
    } else {
        users::table
            .filter(users::id.eq_any(&parent_author_ids))
            .load(&mut conn)
            .await?
    };

    let parent_author_map: std::collections::HashMap<i32, &User> =
        parent_authors.iter().map(|u| (u.id, u)).collect();

    let parent_chat_map: std::collections::HashMap<i32, &Chat> =
        parent_chats.iter().map(|c| (c.id, c)).collect();

    let responses: Vec<ChatResponse> = chat_rows
        .iter()
        .map(|chat| {
            let reply_address = chat.parent_id.and_then(|pid| {
                parent_chat_map
                    .get(&pid)
                    .and_then(|parent| parent_author_map.get(&parent.author_id))
                    .map(|u| u.address.clone())
            });

            ChatResponse {
                id: chat.id,
                token_address: token.token_address.clone(),
                reply_address,
                comment: chat.content.clone(),
                code: chat.code.clone(),
                date: chat.created_at,
                network: chat.network.clone(),
            }
        })
        .collect();

    Ok(Json(responses))
}

// ---------------------------------------------------------------------------
// POST /chats/reply
// ---------------------------------------------------------------------------

pub async fn reply(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ReplyBody>,
) -> AppResult<Json<serde_json::Value>> {
    // Verify signature (fresh + single-use + bound to the comment action)
    let recovered = verify_signed_action(
        &state,
        &body.msg,
        &body.signature,
        Some("Post comment on"),
    )
    .await?;

    // Validate comment
    if body.comment.is_empty() {
        return Err(AppError::BadRequest("Comment cannot be empty".to_string()));
    }
    if body.comment.len() > 1000 {
        return Err(AppError::BadRequest(
            "Comment must be at most 1000 characters".to_string(),
        ));
    }

    // Strip HTML tags (basic sanitization)
    let sanitized_comment = strip_html_tags(&body.comment);

    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    // Find the token
    let token: Token = tokens::table
        .filter(tokens::token_address.eq(&body.token_address))
        .filter(tokens::network.eq(&body.network))
        .first(&mut conn)
        .await
        .optional()?
        .ok_or_else(|| AppError::NotFound("Token not found".to_string()))?;

    // Find the author user by recovered address
    let author: User = users::table
        .filter(users::address.eq(recovered.to_lowercase()))
        .first(&mut conn)
        .await
        .optional()?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    // Build the code for threading: if replying, use parent code prefix
    let code = if let Some(reply_id) = body.reply_id {
        let parent: Chat = chats::table
            .filter(chats::id.eq(reply_id))
            .first(&mut conn)
            .await
            .optional()?
            .ok_or_else(|| AppError::NotFound("Parent chat not found".to_string()))?;

        // Count existing replies to determine child index
        let reply_count: i64 = chats::table
            .filter(chats::parent_id.eq(reply_id))
            .count()
            .get_result(&mut conn)
            .await?;

        let parent_code = parent.code.as_deref().unwrap_or("0");
        Some(format!("{}.{}", parent_code, reply_count + 1))
    } else {
        // Top-level chat: count existing top-level chats
        let top_count: i64 = chats::table
            .filter(chats::token_id.eq(token.id))
            .filter(chats::parent_id.is_null())
            .count()
            .get_result(&mut conn)
            .await?;

        Some(format!("{}", top_count + 1))
    };

    let new_chat = NewChat {
        token_id: token.id,
        author_id: author.id,
        parent_id: body.reply_id,
        content: sanitized_comment,
        code: code.as_deref(),
        network: body.network.clone(),
    };

    let inserted: Chat = diesel::insert_into(chats::table)
        .values(&new_chat)
        .get_result(&mut conn)
        .await?;

    // Increment token reply_count
    diesel::update(tokens::table.filter(tokens::id.eq(token.id)))
        .set(tokens::reply_count.eq(tokens::reply_count + 1))
        .execute(&mut conn)
        .await?;

    let resp = ChatResponse {
        id: inserted.id,
        token_address: token.token_address.clone(),
        reply_address: if body.reply_id.is_some() {
            Some(body.reply_address.clone())
        } else {
            None
        },
        comment: inserted.content,
        code: inserted.code,
        date: inserted.created_at,
        network: inserted.network,
    };

    Ok(Json(serde_json::json!({ "chat": resp })))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Basic HTML tag stripper. Removes anything between < and >.
fn strip_html_tags(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut in_tag = false;

    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => result.push(ch),
            _ => {}
        }
    }

    result
}
