package fyuz

import (
	"context"
	"net/http"
	"testing"
	"time"
)

func TestGetUserLeaderboard(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/users/leaderboard" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if r.URL.Query().Get("limit") != "25" {
			t.Errorf("limit = %q", r.URL.Query().Get("limit"))
		}
		writeJSON(t, w, 200, `[
			{"rank":1,"address":"0xa","username":"alice","avatar":null,"volumeUsd":1200.5,"trades":42,
			 "points":1200.5,"pointsTotal":1500,"pointsProjected":1800.25,"heldUsd":900.1,"rewardEth":0.0421},
			{"rank":2,"address":"0xb","username":null,"avatar":null,"volumeUsd":10,"trades":1,
			 "points":10,"pointsTotal":10,"pointsProjected":10,"heldUsd":0,"rewardEth":0}
		]`)
	})

	board, err := client.GetUserLeaderboard(context.Background(), &LeaderboardOptions{Limit: Int64(25)})
	if err != nil {
		t.Fatalf("GetUserLeaderboard: %v", err)
	}
	if len(board) != 2 {
		t.Fatalf("rows = %d", len(board))
	}
	// Rank is server-assigned and must be preserved in returned order.
	if board[0].Rank != 1 || board[1].Rank != 2 {
		t.Errorf("ranks = %d, %d", board[0].Rank, board[1].Rank)
	}
	if board[0].Username == nil || *board[0].Username != "alice" {
		t.Errorf("username = %v", board[0].Username)
	}
	if board[1].Username != nil {
		t.Error("null username must decode to nil")
	}
	if board[0].PointsProjected != 1800.25 || board[0].RewardEth != 0.0421 {
		t.Errorf("row = %+v", board[0])
	}
}

func TestGetUserProfile(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/users/profile/0xABC" {
			t.Errorf("path = %q", r.URL.Path)
		}
		writeJSON(t, w, 200, `{
			"user":{"id":7,"address":"0xabc","username":"alice","avatar":null,"bio":null,"likes":3,
			        "isAdmin":null,"twitterUsername":"alice_x"},
			"holdings":[],
			"chats":[{"id":1,"tokenAddress":"0x23a8","replyAddress":null,"comment":"gm","code":null,
			          "date":"2026-07-02T11:30:00Z","network":"bsc"}],
			"createdTokens":[],
			"followers":12,"followees":3,"referralCount":2,"points":40,
			"tradingPoints":1200.5,"tradingVolumeUsd":1200.5,"rewardEth":0.042
		}`)
	})

	profile, err := client.GetUserProfile(context.Background(), "0xABC")
	if err != nil {
		t.Fatalf("GetUserProfile: %v", err)
	}
	if profile.User.ID != 7 || profile.User.Likes != 3 {
		t.Errorf("user = %+v", profile.User)
	}
	if profile.User.IsAdmin != nil {
		t.Error("null isAdmin must decode to nil, not false")
	}
	if profile.User.TwitterUsername == nil || *profile.User.TwitterUsername != "alice_x" {
		t.Errorf("twitter = %v", profile.User.TwitterUsername)
	}
	if len(profile.Chats) != 1 {
		t.Fatalf("chats = %d", len(profile.Chats))
	}
	want := time.Date(2026, 7, 2, 11, 30, 0, 0, time.UTC)
	if !profile.Chats[0].Date.Equal(want) {
		t.Errorf("chat date = %v, want %v", profile.Chats[0].Date, want)
	}
	if profile.Chats[0].ReplyAddress != nil {
		t.Error("replyAddress is always null on this endpoint")
	}
	if profile.Points != 40 || profile.TradingPoints != 1200.5 {
		t.Errorf("points = %d / %v", profile.Points, profile.TradingPoints)
	}
}

func TestGetTopHolders(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/users/top/5" {
			t.Errorf("path = %q", r.URL.Path)
		}
		q := r.URL.Query()
		if q.Get("from") != "0" || q.Get("network") != "bsc" {
			t.Errorf("query = %q", r.URL.RawQuery)
		}
		if _, ok := q["to"]; ok {
			t.Error("unset `to` must not be sent")
		}
		writeJSON(t, w, 200, `[{"address":"0xa","username":null,"avatar":null,"volume":98765.43}]`)
	})

	top, err := client.GetTopHolders(context.Background(), 5, &TopHoldersOptions{
		From:    Int64(0),
		Network: "bsc",
	})
	if err != nil {
		t.Fatalf("GetTopHolders: %v", err)
	}
	if len(top) != 1 || top[0].Volume != 98765.43 {
		t.Errorf("top = %+v", top)
	}
}

func TestGetKingsHistory(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/kings/history" {
			t.Errorf("path = %q", r.URL.Path)
		}
		writeJSON(t, w, 200, `[
			{"tokenAddress":"0xa","name":"A","symbol":"A","image":null,"network":"bsc",
			 "startedAt":1751000000,"endedAt":null,"durationSecs":3600},
			{"tokenAddress":"0xb","name":"B","symbol":"B","image":"img","network":"bsc",
			 "startedAt":1750000000,"endedAt":1750003600,"durationSecs":3600}
		]`)
	})

	reigns, err := client.GetKingsHistory(context.Background())
	if err != nil {
		t.Fatalf("GetKingsHistory: %v", err)
	}
	if len(reigns) != 2 {
		t.Fatalf("reigns = %d", len(reigns))
	}
	if !reigns[0].Ongoing() {
		t.Error("a null endedAt means the reign is ongoing")
	}
	if reigns[1].EndedAt == nil || *reigns[1].EndedAt != 1750003600 {
		t.Errorf("endedAt = %v", reigns[1].EndedAt)
	}
	if got := UnixTimePtr(reigns[1].EndedAt); got == nil || got.Unix() != 1750003600 {
		t.Errorf("UnixTimePtr = %v", got)
	}
	if UnixTimePtr(reigns[0].EndedAt) != nil {
		t.Error("UnixTimePtr(nil) must stay nil, not the epoch")
	}
}

func TestGetSeason(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, `{"name":"Season 1","startsAt":1751000000,"endsAt":1753000000,
			"prizePotEth":12.5,"leaderboard":[{"rank":1,"address":"0xa","username":null,"avatar":null,"points":900.5}]}`)
	})

	season, err := client.GetSeason(context.Background())
	if err != nil {
		t.Fatalf("GetSeason: %v", err)
	}
	if season.Name != "Season 1" || season.PrizePotEth != 12.5 {
		t.Errorf("season = %+v", season)
	}
	if len(season.Leaderboard) != 1 || season.Leaderboard[0].Rank != 1 {
		t.Errorf("leaderboard = %+v", season.Leaderboard)
	}
}

func TestGetReferralLeaderboard(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/referrals/leaderboard" {
			t.Errorf("path = %q", r.URL.Path)
		}
		writeJSON(t, w, 200, `[{"rank":1,"address":"0xa","username":null,"avatar":null,
			"referralCount":9,"refereeVolumeUsd":4321.5}]`)
	})

	rows, err := client.GetReferralLeaderboard(context.Background(), nil)
	if err != nil {
		t.Fatalf("GetReferralLeaderboard: %v", err)
	}
	if len(rows) != 1 || rows[0].ReferralCount != 9 || rows[0].RefereeVolumeUsd != 4321.5 {
		t.Errorf("rows = %+v", rows)
	}
}

func TestGetTier(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/tier/0xabc" {
			t.Errorf("path = %q", r.URL.Path)
		}
		writeJSON(t, w, 200, `{"address":"0xabc","volumeUsd":15000,"tier":"Diamond",
			"nextTier":null,"nextThresholdUsd":null,"progressPct":100}`)
	})

	info, err := client.GetTier(context.Background(), "0xabc")
	if err != nil {
		t.Fatalf("GetTier: %v", err)
	}
	if info.Tier != TierDiamond {
		t.Errorf("tier = %q", info.Tier)
	}
	if info.NextTier != nil || info.NextThresholdUsd != nil {
		t.Error("the top tier has no next tier")
	}
	if info.ProgressPct != 100 {
		t.Errorf("progress = %v", info.ProgressPct)
	}
}

func TestGetRewards(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, `{"address":"0xabc","currentStreak":4,"longestStreak":11,
			"points":1200.5,"bonusPoints":150,
			"quests":[{"key":"daily_trade","title":"Trade today","description":"d","kind":"daily",
			           "target":1,"progress":1,"points":25,"completed":true,"claimed":true}],
			"achievements":[{"key":"first_trade","title":"First trade","description":"d","icon":"star",
			                 "points":10,"earned":true}]}`)
	})

	rewards, err := client.GetRewards(context.Background(), "0xabc")
	if err != nil {
		t.Fatalf("GetRewards: %v", err)
	}
	if rewards.CurrentStreak != 4 || rewards.LongestStreak != 11 {
		t.Errorf("streaks = %d/%d", rewards.CurrentStreak, rewards.LongestStreak)
	}
	if len(rewards.Quests) != 1 || !rewards.Quests[0].Completed || rewards.Quests[0].Points != 25 {
		t.Errorf("quests = %+v", rewards.Quests)
	}
	if len(rewards.Achievements) != 1 || !rewards.Achievements[0].Earned {
		t.Errorf("achievements = %+v", rewards.Achievements)
	}
}

func TestGetPortfolioAndWallet(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/portfolio/0xabc":
			writeJSON(t, w, 200, `{"address":"0xabc","totalValueUsd":100.5,"totalCostUsd":80,
				"unrealizedPnlUsd":20.5,"realizedPnlUsd":5,"totalPnlUsd":25.5,"roiPct":31.875,
				"positions":[{"tokenAddress":"0x1","name":"A","symbol":"A","image":null,"network":"bsc",
				 "balance":1000,"currentPriceUsd":0.1005,"valueUsd":100.5,"costUsd":80,
				 "avgBuyPriceUsd":0.08,"unrealizedPnlUsd":20.5,"unrealizedPnlPct":25.6,"realizedPnlUsd":5}]}`)
		case "/wallet/0xabc":
			writeJSON(t, w, 200, `{"address":"0xabc","username":null,"avatar":null,"volumeUsd":500,
				"realizedPnlUsd":5,"unrealizedPnlUsd":20.5,"totalPnlUsd":25.5,"roiPct":31.875,
				"winRate":0.66,"tokensTraded":3,"tradeCount":9,"holdingValueUsd":100.5}`)
		default:
			t.Errorf("unexpected path %q", r.URL.Path)
		}
	})

	ctx := context.Background()
	pf, err := client.GetPortfolio(ctx, "0xabc")
	if err != nil {
		t.Fatalf("GetPortfolio: %v", err)
	}
	if len(pf.Positions) != 1 || pf.Positions[0].Balance != 1000 {
		t.Errorf("positions = %+v", pf.Positions)
	}
	if pf.RoiPct != 31.875 {
		t.Errorf("roi = %v", pf.RoiPct)
	}

	ws, err := client.GetWallet(ctx, "0xabc")
	if err != nil {
		t.Fatalf("GetWallet: %v", err)
	}
	if ws.TradeCount != 9 || ws.WinRate != 0.66 {
		t.Errorf("wallet = %+v", ws)
	}
}

func TestAnalyticsEndpoints(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/analytics/token/bsc/0x23a8":
			writeJSON(t, w, 200, `{"tokenAddress":"0x23a8","network":"bsc","holderCount":120,
				"top10Pct":42.5,"creatorPct":3.1,"buys":80,"sells":40,"volumeUsd":9000,
				"graduationPct":14.9,"launched":false,"bundleBuyers":2,"bundleFlag":true}`)
		case "/analytics/top-traders/bsc/0x23a8":
			writeJSON(t, w, 200, `[{"address":"0xa","username":null,"avatar":null,"realizedPnlUsd":10,
				"unrealizedPnlUsd":5,"totalPnlUsd":15,"volumeUsd":100,"isCreator":true}]`)
		default:
			t.Errorf("unexpected path %q", r.URL.Path)
		}
	})

	ctx := context.Background()
	an, err := client.GetTokenAnalytics(ctx, "bsc", "0x23a8")
	if err != nil {
		t.Fatalf("GetTokenAnalytics: %v", err)
	}
	if an.HolderCount != 120 || !an.BundleFlag || an.BundleBuyers != 2 {
		t.Errorf("analytics = %+v", an)
	}

	traders, err := client.GetTopTraders(ctx, "bsc", "0x23a8")
	if err != nil {
		t.Fatalf("GetTopTraders: %v", err)
	}
	if len(traders) != 1 || !traders[0].IsCreator {
		t.Errorf("traders = %+v", traders)
	}
}
