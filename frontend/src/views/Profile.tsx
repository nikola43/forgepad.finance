'use client'

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
    Avatar, Box, Button, CircularProgress, IconButton, Tab, Tabs,
    TextField, Typography, styled, useMediaQuery
} from "@mui/material"
import EditIcon from '@mui/icons-material/Edit'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CheckIcon from '@mui/icons-material/Check'
import CameraAltIcon from '@mui/icons-material/CameraAlt'
import PersonAddIcon from '@mui/icons-material/PersonAdd'
import PersonRemoveIcon from '@mui/icons-material/PersonRemove'
import FavoriteIcon from '@mui/icons-material/Favorite'
import ShareIcon from '@mui/icons-material/Share'
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch'
import DiamondIcon from '@mui/icons-material/Diamond'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline'
import GroupIcon from '@mui/icons-material/Group'
import SearchIcon from '@mui/icons-material/Search'
import { type Provider as EVMProvider, useAppKitAccount, useAppKitProvider } from "@reown/appkit/react"
import { BrowserProvider } from "ethers"
import axios from "axios"
import toast from "react-hot-toast"
import { mutate as mutateGlobal } from "swr"
import Image from "next/image"
import TwitterIcon from "@/assets/images/x.svg"

import { ChainController } from "@reown/appkit-controllers"

import PageBox from "@/components/layout/pageBox"
import { getProfilePic, UserAvatar, UserName } from "@/components/cards/user"
import TokenLogo from "@/components/tokenLogo"
import { ProfileSkeleton, ListSkeleton } from "@/components/Skeleton"
import EmptyStateComponent from "@/components/EmptyState"
import { useUserProfile } from "@/hooks/user"
import { useRewards } from "@/hooks/rewards"
import { useReferralSummary } from "@/hooks/referrals"
import { useHandlers } from "@/hooks/token"
import { useMainContext } from "@/context"
import { API_ENDPOINT } from "@/config"
import { priceFormatter } from "@/utils/price"
import Link from "next/link"

const StatBox = styled(Box)<{ clickable?: number }>`
    text-align: center;
    padding: 16px;
    border-radius: 12px;
    background: rgba(234, 230, 218, 0.03);
    border: 1px solid rgba(234, 230, 218, 0.06);
    flex: 1;
    min-width: 80px;
    cursor: ${({ clickable }) => clickable ? 'pointer' : 'default'};
    transition: all 0.2s ease;
    ${({ clickable }) => clickable ? `
        &:hover {
            background: rgba(234, 230, 218, 0.06);
            border-color: rgba(191, 209, 67, 0.2);
        }
    ` : ''}
`

const StyledTab = styled(Tab)`
    text-transform: none;
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 600;
    font-size: 14px;
    color: #6F6F68;
    min-height: 40px;
    &.Mui-selected {
        color: #BFD143;
    }
`

const ItemCard = styled(Box)`
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-radius: 12px;
    background: rgba(234, 230, 218, 0.03);
    border: 1px solid rgba(234, 230, 218, 0.06);
    cursor: pointer;
    transition: all 0.2s ease;
    &:hover {
        background: rgba(234, 230, 218, 0.06);
        border-color: rgba(191, 209, 67, 0.2);
    }
    &:active {
        transform: scale(0.98);
    }
`

const AvatarWrapper = styled(Box)`
    position: relative;
    display: inline-flex;
    &:hover .avatar-overlay {
        opacity: 1;
    }
`

const AvatarOverlay = styled(Box)`
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.2s ease;
    cursor: pointer;
`

const FollowButton = styled(Button)<{ following?: number }>`
    border-radius: 100px;
    text-transform: none;
    font-weight: 600;
    font-size: 13px;
    padding: 6px 20px;
    min-width: 100px;
    font-family: 'Space Grotesk', sans-serif;
    ${({ following }) => following ? `
        background: rgba(234, 230, 218, 0.06);
        color: #8C8C85;
        border: 1px solid rgba(234, 230, 218, 0.1);
        &:hover {
            background: rgba(214, 69, 69, 0.1);
            border-color: rgba(214, 69, 69, 0.3);
            color: #D64545;
        }
    ` : `
        background: #BFD143;
        color: var(--moss-black);
        border: none;
        &:hover {
            background: #D3E063;
        }
    `}
    &:active {
        transform: scale(0.98);
    }
`

const LikeButton = styled(IconButton)`
    color: #6F6F68;
    transition: all 0.2s ease;
    &:hover {
        color: #D64545;
    }
    &.liked {
        color: #D64545;
    }
`

const ProgressBar = styled('div')<{ value: number }>`
    height: 3px;
    background: rgba(234, 230, 218, 0.06);
    border-radius: 100px;
    overflow: hidden;
    width: 100%;
    &::after {
        content: "";
        display: block;
        height: 100%;
        width: ${({ value }) => Math.min(100, value)}%;
        background: #BFD143;
        border-radius: 100px;
    }
`

/// Claim a launched token's accrued V3/V4 trading fees — 50% creator, 50% platform.
/// Its own component rather than inline in the list, because each token can be on a
/// different chain and useHandlers is a hook: it can't be called inside a .map().
/// Renders nothing unless there is actually something to claim, so V2 tokens, tokens
/// still on the curve, and tokens with no fees yet never show a dead button.
const ClaimFeesButton = ({ token, onClaimed }: { token: any, onClaimed: () => void }) => {
    const { chains } = useMainContext()
    const tokenChain = useMemo(() => chains?.find(c => c.network === token.network), [chains, token.network])
    const networks = ChainController.getCaipNetworks()
    const tokenNetwork = useMemo(
        () => networks.find(n => n.id === tokenChain?.chainId || n.chainNamespace === tokenChain?.chainId),
        [networks, tokenChain]
    )
    const handlers = useHandlers(tokenNetwork)

    const [fees, setFees] = useState<{ eth: string, token: string } | undefined>()
    const [claiming, setClaiming] = useState(false)

    const getClaimableFees = (handlers as any)?.getClaimableFees

    useEffect(() => {
        if (!token.launchedAt || !getClaimableFees) return
        let active = true
        getClaimableFees(token.tokenAddress)
            .then((f: any) => { if (active) setFees(f) })
            .catch(() => { if (active) setFees(undefined) })
        return () => { active = false }
    }, [token.tokenAddress, token.launchedAt, getClaimableFees])

    const hasFees = fees && (Number(fees.eth) > 0 || Number(fees.token) > 0)
    if (!hasFees) return null

    const claim = async (e: React.MouseEvent) => {
        // The whole card is a Link to the token page; claiming must not navigate.
        e.preventDefault()
        e.stopPropagation()
        if (!(handlers as any)?.claimFees) return
        setClaiming(true)
        try {
            const tx = await (handlers as any).claimFees(token.tokenAddress)
            await tx.wait()
            toast.success('Fees claimed')
            setFees(undefined)
            onClaimed()
        } catch (err: any) {
            toast.error(err?.reason || err?.message || 'Failed to claim fees')
        } finally {
            setClaiming(false)
        }
    }

    // Only half of what's collected reaches the creator, so show their half rather
    // than the gross figure — otherwise the button promises more than it pays.
    const creatorEth = (Number(fees!.eth) / 2).toFixed(5)

    return (
        <Button
            onClick={claim}
            disabled={claiming}
            size="small"
            sx={{
                background: 'rgba(191,209,67,0.12)',
                border: '1px solid rgba(191,209,67,0.35)',
                borderRadius: '8px',
                px: 1.2, py: 0.3, minWidth: 0, flexShrink: 0,
                textTransform: 'none',
                '&:hover': { background: 'rgba(191,209,67,0.22)' },
            }}
        >
            {claiming
                ? <CircularProgress size={13} sx={{ color: '#BFD143' }} />
                : <Typography fontSize={11} fontWeight={700} color="#BFD143" fontFamily="var(--font-data)" noWrap>
                    Claim {creatorEth} BNB
                </Typography>}
        </Button>
    )
}

export default function Profile() {
    const searchParams = useSearchParams()
    const addressParam = searchParams.get('address')
    const { address: connectedAddress, isConnected } = useAppKitAccount()
    const { walletProvider } = useAppKitProvider<EVMProvider>("eip155")
    const isMobile = useMediaQuery('(max-width: 800px)')

    const profileAddress = useMemo(() => {
        if (addressParam === 'me') return connectedAddress
        return addressParam ?? undefined
    }, [addressParam, connectedAddress])

    const isOwnProfile = useMemo(() => {
        return isConnected && connectedAddress?.toLowerCase() === profileAddress?.toLowerCase()
    }, [isConnected, connectedAddress, profileAddress])

    const { profile, reloadProfile } = useUserProfile(profileAddress)
    const { rewards: profileRewards } = useRewards(profileAddress)
    const { summary: referralSummary } = useReferralSummary(profileAddress)
    const router = useRouter()

    const [tab, setTab] = useState(0)
    const [editing, setEditing] = useState(false)
    const [editUsername, setEditUsername] = useState('')
    const [editBio, setEditBio] = useState('')
    const [editTwitter, setEditTwitter] = useState('')
    const [saving, setSaving] = useState(false)
    const [uploadingAvatar, setUploadingAvatar] = useState(false)
    const [copied, setCopied] = useState(false)
    const [followLoading, setFollowLoading] = useState(false)
    const [ethUsd, setEthUsd] = useState<number | null>(null)

    // Free BNB/USD price (Coinbase → CoinGecko) for reward conversion; rewards
    // are paid in the native gas token, which is BNB on BSC. Public,
    // CORS-enabled, no key; USD line just hides if both fail.
    useEffect(() => {
        let active = true
        const fetchEthUsd = async () => {
            try {
                const { data } = await axios.get('https://api.coinbase.com/v2/prices/BNB-USD/spot', { timeout: 8000 })
                const p = Number(data?.data?.amount)
                if (active && p > 0) { setEthUsd(p); return }
            } catch { /* fall through */ }
            try {
                const { data } = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd', { timeout: 8000 })
                const p = Number(data?.binancecoin?.usd)
                if (active && p > 0) setEthUsd(p)
            } catch { /* leave null */ }
        }
        fetchEthUsd()
        const id = setInterval(fetchEthUsd, 60000)
        return () => { active = false; clearInterval(id) }
    }, [])
    const fileInputRef = useRef<HTMLInputElement>(null)

    const user = profile?.user
    console.log('[Profile] profileAddress:', profileAddress)
    console.log('[Profile] profile.user:', user)
    console.log('[Profile] user?.avatar:', user?.avatar)
    const profilePic = getProfilePic(user, profileAddress)
    console.log('[Profile] profilePic:', profilePic)
    const shortAddr = profileAddress ? `${profileAddress.slice(0, 6)}...${profileAddress.slice(-4)}` : ''

    // Check if connected user follows this profile
    const [followOverride, setFollowOverride] = useState<boolean | null>(null)
    const isFollowing = useMemo(() => {
        if (followOverride !== null) return followOverride
        if (!connectedAddress) return false
        // Check followers array if available
        if (Array.isArray(profile?.followers) && profile.followers.length > 0) {
            return profile.followers.some((f: any) =>
                (f.followerId ?? f.address)?.toLowerCase() === connectedAddress.toLowerCase()
            )
        }
        return false
    }, [connectedAddress, profile?.followers, followOverride])

    // Reset follow override when profile reloads
    useEffect(() => {
        setFollowOverride(null)
    }, [profile])

    const startEdit = useCallback(() => {
        setEditUsername(user?.username ?? '')
        setEditBio(user?.bio ?? '')
        setEditTwitter(user?.twitterUsername ?? '')
        setEditing(true)
    }, [user])

    const saveProfile = useCallback(async () => {
        if (!walletProvider || !connectedAddress) return
        setSaving(true)
        try {
            const provider = new BrowserProvider(walletProvider)
            const signer = await provider.getSigner()
            const msg = `Update profile\n${connectedAddress}\n${Date.now()}`
            const signature = await signer.signMessage(msg)
            await axios.post(`${API_ENDPOINT}/users/update`, {
                user: { username: editUsername, bio: editBio, avatar: user?.avatar || null, twitter: editTwitter.trim() },
                signature,
                msg
            })
            toast.success('Profile updated')
            setEditing(false)
            reloadProfile()
            // The header's wallet button reads useAccount()'s ['/account', address]
            // SWR cache, which never revalidates on its own (revalidateOnFocus is
            // off) — without this the old username/avatar sticks until a reload.
            mutateGlobal(['/account', connectedAddress])
        } catch (err: any) {
            const errMsg = err?.response?.data?.error || err?.message || 'Update failed'
            toast.error(errMsg)
        } finally {
            setSaving(false)
        }
    }, [walletProvider, connectedAddress, editUsername, editBio, editTwitter, user, reloadProfile])

    const handleAvatarUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file || !walletProvider || !connectedAddress) return
        setUploadingAvatar(true)
        try {
            const provider = new BrowserProvider(walletProvider)
            const signer = await provider.getSigner()
            // No newlines: multipart/form-data normalizes \n -> \r\n in field
            // values, which would change the bytes the backend recovers from and
            // yield the wrong signer address.
            const msg = `Upload avatar ${connectedAddress} ${Date.now()}`
            const signature = await signer.signMessage(msg)
            const formData = new FormData()
            formData.append('avatar', file)
            formData.append('signature', signature)
            formData.append('msg', msg)
            await axios.post(`${API_ENDPOINT}/users/avatar`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            })
            toast.success('Avatar updated')
            reloadProfile()
            // Keep the header's wallet-button avatar in sync (see saveProfile).
            mutateGlobal(['/account', connectedAddress])
        } catch (err: any) {
            const errMsg = err?.response?.data?.error || err?.message || 'Upload failed'
            toast.error(errMsg)
        } finally {
            setUploadingAvatar(false)
            if (fileInputRef.current) fileInputRef.current.value = ''
        }
    }, [walletProvider, connectedAddress, reloadProfile])

    const handleFollow = useCallback(async () => {
        if (!walletProvider || !connectedAddress || !profileAddress) return
        setFollowLoading(true)
        try {
            const provider = new BrowserProvider(walletProvider)
            const signer = await provider.getSigner()
            const action = isFollowing ? 'Unfollow' : 'Follow'
            const msg = `${action} ${profileAddress}\n${Date.now()}`
            const signature = await signer.signMessage(msg)
            const endpoint = isFollowing
                ? `${API_ENDPOINT}/users/unfollow/${profileAddress}`
                : `${API_ENDPOINT}/users/follow/${profileAddress}`
            await axios.post(endpoint, { signature, msg })
            toast.success(isFollowing ? 'Unfollowed' : 'Following')
            setFollowOverride(!isFollowing)
            reloadProfile()
        } catch (err: any) {
            const errMsg = err?.response?.data?.error || err?.message || 'Failed'
            toast.error(errMsg)
        } finally {
            setFollowLoading(false)
        }
    }, [walletProvider, connectedAddress, profileAddress, isFollowing, reloadProfile])

    const handleLike = useCallback(async () => {
        if (!profileAddress) return
        try {
            await axios.get(`${API_ENDPOINT}/users`, {
                params: { userAddress: profileAddress, addLike: true }
            })
            reloadProfile()
        } catch (err: any) {
            const errMsg = err?.response?.data?.error || err?.message || 'Failed'
            toast.error(errMsg)
        }
    }, [profileAddress, reloadProfile])

    const copyAddress = useCallback(() => {
        if (profileAddress) {
            navigator.clipboard.writeText(profileAddress)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        }
    }, [profileAddress])

    if (!profileAddress) {
        return (
            <PageBox>
                <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
                    <Typography color="#6F6F68" fontSize={16}>
                        {addressParam === 'me' ? 'Connect your wallet to view profile' : 'No address specified'}
                    </Typography>
                </Box>
            </PageBox>
        )
    }

    if (!user && !profile) {
        return (
            <PageBox>
                <ProfileSkeleton />
            </PageBox>
        )
    }

    return (
        <PageBox>
            <Box sx={{
                background: 'rgba(191, 209, 67, 0.04)',
                borderRadius: '24px',
                border: '1px solid rgba(191, 209, 67, 0.08)',
                p: { xs: 3, sm: 4 },
                mb: 3,
                position: 'relative',
                overflow: 'hidden',
            }}>
                <Box display="flex" flexDirection={{ xs: 'column', sm: 'row' }} gap={3} alignItems={{ sm: 'flex-start' }}>
                    {/* Avatar */}
                    <AvatarWrapper onClick={isOwnProfile ? () => fileInputRef.current?.click() : undefined}>
                        <Avatar
                            src={profilePic}
                            sx={{ width: isMobile ? 80 : 100, height: isMobile ? 80 : 100, border: '2px solid rgba(191,209,67,0.3)' }}
                        />
                        {isOwnProfile && (
                            <AvatarOverlay className="avatar-overlay">
                                {uploadingAvatar
                                    ? <CircularProgress size={24} sx={{ color: 'var(--bone)' }} />
                                    : <CameraAltIcon sx={{ color: 'var(--bone)', fontSize: 28 }} />
                                }
                            </AvatarOverlay>
                        )}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            hidden
                            onChange={handleAvatarUpload}
                        />
                    </AvatarWrapper>

                    {/* Info */}
                    <Box flex={1} minWidth={0}>
                        {editing ? (
                            <Box display="flex" flexDirection="column" gap={1.5}>
                                <TextField
                                    size="small"
                                    placeholder="Username"
                                    value={editUsername}
                                    onChange={e => setEditUsername(e.target.value)}
                                    slotProps={{ input: { sx: { borderRadius: '10px', background: 'rgba(234,230,218,0.05)', color: 'var(--bone)' } } }}
                                />
                                <TextField
                                    size="small"
                                    placeholder="Bio"
                                    multiline
                                    maxRows={3}
                                    value={editBio}
                                    onChange={e => setEditBio(e.target.value)}
                                    slotProps={{ input: { sx: { borderRadius: '10px', background: 'rgba(234,230,218,0.05)', color: 'var(--bone)' } } }}
                                />
                                <TextField
                                    size="small"
                                    placeholder="X / Twitter handle (optional, e.g. @fyuzfun)"
                                    value={editTwitter}
                                    onChange={e => setEditTwitter(e.target.value)}
                                    slotProps={{ input: { sx: { borderRadius: '10px', background: 'rgba(234,230,218,0.05)', color: 'var(--bone)' } } }}
                                />
                                <Box display="flex" gap={1}>
                                    <Button
                                        size="small"
                                        variant="contained"
                                        disabled={saving}
                                        onClick={saveProfile}
                                        sx={{ borderRadius: '10px', textTransform: 'none', background: '#BFD143', color: 'var(--moss-black)', fontWeight: 600, '&:hover': { background: '#D3E063' } }}
                                    >
                                        {saving ? <CircularProgress size={16} sx={{ color: 'var(--moss-black)' }} /> : 'Save'}
                                    </Button>
                                    <Button
                                        size="small"
                                        onClick={() => setEditing(false)}
                                        sx={{ borderRadius: '10px', textTransform: 'none', color: '#8C8C85' }}
                                    >
                                        Cancel
                                    </Button>
                                </Box>
                            </Box>
                        ) : (
                            <>
                                <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                                    <Typography fontSize={{ xs: 20, sm: 24 }} fontWeight={700} color="var(--bone)" fontFamily="var(--font-display)" noWrap>
                                        {user?.username?.trim() || shortAddr}
                                    </Typography>
                                    {isOwnProfile && (
                                        <IconButton size="small" onClick={startEdit} sx={{ color: '#6F6F68', '&:hover': { color: '#BFD143' } }}>
                                            <EditIcon fontSize="small" />
                                        </IconButton>
                                    )}
                                    {/* Follow / Like buttons */}
                                    {!isOwnProfile && isConnected && (
                                        <Box display="flex" gap={1} ml="auto">
                                            <FollowButton
                                                following={isFollowing ? 1 : 0}
                                                onClick={handleFollow}
                                                disabled={followLoading}
                                                startIcon={followLoading
                                                    ? <CircularProgress size={14} sx={{ color: 'inherit' }} />
                                                    : isFollowing ? <PersonRemoveIcon sx={{ fontSize: 16 }} /> : <PersonAddIcon sx={{ fontSize: 16 }} />
                                                }
                                            >
                                                {isFollowing ? 'Unfollow' : 'Follow'}
                                            </FollowButton>
                                            <LikeButton size="small" onClick={handleLike}>
                                                <FavoriteIcon sx={{ fontSize: 20 }} />
                                            </LikeButton>
                                        </Box>
                                    )}
                                </Box>
                                <Box display="flex" alignItems="center" gap={0.5} mt={0.5}>
                                    <Typography fontSize={13} color="#6F6F68" fontFamily="var(--font-data)">{shortAddr}</Typography>
                                    <IconButton size="small" onClick={copyAddress} sx={{ color: '#6F6F68', p: 0.3 }}>
                                        {copied ? <CheckIcon sx={{ fontSize: 14, color: '#3FA968' }} /> : <ContentCopyIcon sx={{ fontSize: 14 }} />}
                                    </IconButton>
                                    <IconButton size="small" onClick={() => {
                                        navigator.clipboard.writeText(`${window.location.origin}/profile?address=${profileAddress}`)
                                        toast.success('Profile link copied!')
                                    }} sx={{ color: '#6F6F68', p: 0.3 }}>
                                        <ShareIcon sx={{ fontSize: 16 }} />
                                    </IconButton>
                                    {(user?.likes ?? 0) > 0 && (
                                        <Box display="flex" alignItems="center" gap={0.3} ml={1}>
                                            <FavoriteIcon sx={{ fontSize: 13, color: '#D64545' }} />
                                            <Typography fontSize={12} color="#D64545" fontWeight={600}>{user.likes}</Typography>
                                        </Box>
                                    )}
                                    {user?.twitterUsername && (
                                        <a
                                            href={`https://x.com/${user.twitterUsername}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8, textDecoration: 'none' }}
                                        >
                                            <Image src={TwitterIcon} width={12} height={12} alt="X" />
                                            <Typography fontSize={12} color="#8C8C85" fontFamily="var(--font-data)" sx={{ '&:hover': { color: 'var(--citron)' } }}>
                                                @{user.twitterUsername}
                                            </Typography>
                                        </a>
                                    )}
                                </Box>
                                {user?.bio && (
                                    <Typography fontSize={14} color="#8C8C85" mt={1} sx={{ wordBreak: 'break-word' }}>
                                        {user.bio}
                                    </Typography>
                                )}
                            </>
                        )}
                    </Box>
                </Box>

                {/* Stats */}
                <Box display="flex" gap={1.5} mt={3} flexWrap="wrap">
                    <StatBox className="animate-fade-in" clickable={1} onClick={() => setTab(0)} sx={{
                        transition: 'all 0.2s ease',
                        '&:hover': {
                            borderColor: 'rgba(191,209,67,0.3)',
                        }
                    }}>
                        <Typography fontSize={20} fontWeight={700} color="var(--bone)" fontFamily="var(--font-display)">
                            {profile?.tokens?.length ?? 0}
                        </Typography>
                        <Typography fontSize={11} color="#6F6F68" fontWeight={500} textTransform="uppercase" letterSpacing="2px" fontFamily="var(--font-data)">Tokens Created</Typography>
                    </StatBox>
                    <StatBox className="animate-fade-in" clickable={1} onClick={() => setTab(1)} sx={{
                        transition: 'all 0.2s ease',
                        '&:hover': {
                            borderColor: 'rgba(191,209,67,0.3)',
                        }
                    }}>
                        <Typography fontSize={20} fontWeight={700} color="var(--bone)" fontFamily="var(--font-display)">
                            {profile?.helds?.length ?? 0}
                        </Typography>
                        <Typography fontSize={11} color="#6F6F68" fontWeight={500} textTransform="uppercase" letterSpacing="2px" fontFamily="var(--font-data)">Holdings</Typography>
                    </StatBox>
                    <StatBox className="animate-fade-in" clickable={1} onClick={() => setTab(3)} sx={{
                        transition: 'all 0.2s ease',
                        '&:hover': {
                            borderColor: 'rgba(191,209,67,0.3)',
                        }
                    }}>
                        <Typography fontSize={20} fontWeight={700} color="var(--bone)" fontFamily="var(--font-display)">
                            {profile?.followerCount ?? profile?.followers?.length ?? 0}
                        </Typography>
                        <Typography fontSize={11} color="#6F6F68" fontWeight={500} textTransform="uppercase" letterSpacing="2px" fontFamily="var(--font-data)">Followers</Typography>
                    </StatBox>
                    <StatBox className="animate-fade-in" clickable={1} onClick={() => setTab(4)} sx={{
                        transition: 'all 0.2s ease',
                        '&:hover': {
                            borderColor: 'rgba(191,209,67,0.3)',
                        }
                    }}>
                        <Typography fontSize={20} fontWeight={700} color="var(--bone)" fontFamily="var(--font-display)">
                            {profile?.followeeCount ?? profile?.followees?.length ?? 0}
                        </Typography>
                        <Typography fontSize={11} color="#6F6F68" fontWeight={500} textTransform="uppercase" letterSpacing="2px" fontFamily="var(--font-data)">Following</Typography>
                    </StatBox>
                    <StatBox
                        className="animate-fade-in"
                        clickable={isOwnProfile ? 1 : 0}
                        onClick={isOwnProfile ? () => router.push('/referrals') : undefined}
                        title={isOwnProfile ? 'Open your referral link — every referred trader earns you +25 points' : undefined}
                        sx={isOwnProfile ? { transition: 'all 0.2s ease', '&:hover': { borderColor: 'rgba(191,209,67,0.3)' } } : undefined}
                    >
                        <Typography fontSize={20} fontWeight={700} color="var(--bone)" fontFamily="var(--font-display)">
                            {referralSummary?.referralCount ?? 0}
                        </Typography>
                        <Typography fontSize={11} color="#6F6F68" fontWeight={500} textTransform="uppercase" letterSpacing="2px" fontFamily="var(--font-data)">Referrals</Typography>
                    </StatBox>
                    <StatBox className="animate-fade-in" clickable={0}>
                        <Typography fontSize={20} fontWeight={700} color="#BFD143" fontFamily="var(--font-data)">
                            {priceFormatter(profile?.tradingPoints ?? 0, 2)}
                        </Typography>
                        <Typography fontSize={11} color="#6F6F68" fontWeight={500} textTransform="uppercase" letterSpacing="2px" fontFamily="var(--font-data)">Points</Typography>
                    </StatBox>
                    <StatBox className="animate-fade-in" clickable={0}>
                        <Typography fontSize={16} fontWeight={700} color="#3FA968" fontFamily="var(--font-data)">
                            {priceFormatter(profile?.rewardEth ?? 0, 6)} BNB
                        </Typography>
                        <Typography fontSize={11} color="#6F6F68" fontWeight={500} textTransform="uppercase" letterSpacing="2px" fontFamily="var(--font-data)">
                            Reward{ethUsd != null ? ` · $${((profile?.rewardEth ?? 0) * ethUsd).toFixed(2)}` : ''}
                        </Typography>
                    </StatBox>
                </Box>

                {/* Achievement badges */}
                {!!profileRewards?.achievements?.some((a) => a.earned) && (
                    <Box display="flex" gap={1} mt={2} flexWrap="wrap" alignItems="center">
                        <Typography fontSize={11} color="#6F6F68" textTransform="uppercase" letterSpacing="2px" fontFamily="var(--font-data)" mr={0.5}>Badges</Typography>
                        {profileRewards.achievements.filter((a) => a.earned).map((a) => (
                            <Box key={a.key} title={`${a.title} — ${a.description}`} sx={{ fontSize: 22, lineHeight: 1, px: 0.75, py: 0.5, borderRadius: '10px', border: '1px solid rgba(191,209,67,0.3)', background: 'rgba(191,209,67,0.06)', cursor: 'default' }}>
                            {a.icon}
                            </Box>
                        ))}
                    </Box>
                )}
            </Box>

            {/* Tabs */}
            <Box mt={3}>
                <Tabs
                    value={tab}
                    onChange={(_, v) => setTab(v)}
                    variant={isMobile ? "scrollable" : "standard"}
                    scrollButtons="auto"
                    sx={{ '& .MuiTabs-indicator': { background: '#BFD143' }, minHeight: 40 }}
                >
                    <StyledTab label={`Promoted (${profile?.tokens?.length ?? 0})`} />
                    <StyledTab label={`Holdings (${profile?.helds?.length ?? 0})`} />
                    <StyledTab label={`Replies (${profile?.replies?.length ?? 0})`} />
                    <StyledTab label={`Followers (${profile?.followerCount ?? profile?.followers?.length ?? 0})`} />
                    <StyledTab label={`Following (${profile?.followeeCount ?? profile?.followees?.length ?? 0})`} />
                </Tabs>

                <Box key={tab} className="animate-fade-in" mt={2} display="flex" flexDirection="column" gap={1}>
                    {/* Created Tokens (Promoted tab) */}
                    {tab === 0 && (
                        !profile
                            ? <ListSkeleton count={3} />
                            : profile.tokens?.length > 0
                                ? <Box className="stagger-children" display="flex" flexDirection="column" gap={1}>
                                    {profile.tokens.map((token: any) => (
                                        <Link key={token.tokenAddress} href={`/token?network=${token.network}&address=${token.tokenAddress}`} style={{ textDecoration: 'none' }}>
                                            <ItemCard>
                                                <TokenLogo logo={token.tokenImage} size="44px" style={{ borderRadius: '10px', flexShrink: 0 }} />
                                                <Box flex={1} minWidth={0}>
                                                    <Box display="flex" alignItems="center" gap={1}>
                                                        <Typography fontSize={14} fontWeight={600} color="var(--bone)" noWrap>{token.tokenName}</Typography>
                                                        <Typography fontSize={12} color="#6F6F68" fontFamily="var(--font-data)">{token.tokenSymbol}</Typography>
                                                        <img src={`/networks/${token.network}.svg`} height={14} alt="" />
                                                    </Box>
                                                    <Box display="flex" alignItems="center" gap={2} mt={0.5}>
                                                        <Typography fontSize={12} color="#BFD143" fontWeight={600} fontFamily="var(--font-data)">MC: ${priceFormatter(token.marketcap, 2)}</Typography>
                                                        {token.volume > 0 && (
                                                            <Typography fontSize={11} color="#6F6F68" fontFamily="var(--font-data)">Vol: ${priceFormatter(token.volume, 2, true, true)}</Typography>
                                                        )}
                                                    </Box>
                                                    {!token.launchedAt && token.progress !== undefined && (
                                                        <Box mt={0.5}>
                                                            <ProgressBar value={Number(token.progress ?? 0)} />
                                                        </Box>
                                                    )}
                                                </Box>
                                                {isOwnProfile && token.launchedAt && (
                                                    <ClaimFeesButton token={token} onClaimed={reloadProfile} />
                                                )}
                                                {token.launchedAt ? (
                                                    <Box sx={{ background: 'rgba(232,106,43,0.1)', border: '1px solid rgba(232,106,43,0.2)', borderRadius: '8px', px: 1, py: 0.3 }}>
                                                        <Typography fontSize={11} fontWeight={600} color="var(--tangerine)">Champion</Typography>
                                                    </Box>
                                                ) : (
                                                    <Typography fontSize={11} color="#6F6F68" fontFamily="var(--font-data)">{Number(token.progress ?? 0).toFixed(1)}%</Typography>
                                                )}
                                            </ItemCard>
                                        </Link>
                                    ))}
                                </Box>
                                : <EmptyStateComponent icon={<RocketLaunchIcon sx={{ fontSize: 32, color: 'var(--muted)' }} />} title="No bouts booked yet" description="Create your first token and start building your fight record" />
                    )}

                    {/* Holdings */}
                    {tab === 1 && (
                        !profile
                            ? <ListSkeleton count={3} />
                            : profile.helds?.length > 0
                                ? <Box className="stagger-children" display="flex" flexDirection="column" gap={1}>
                                    {profile.helds.map((held: any) => (
                                        <Link key={held.id ?? held.tokenAddress} href={`/token?network=${held.network ?? 'localhost'}&address=${held.tokenAddress}`} style={{ textDecoration: 'none' }}>
                                            <ItemCard>
                                                <TokenLogo logo={held.tokenImage ?? held.token?.tokenImage} size="44px" style={{ borderRadius: '10px', flexShrink: 0 }} />
                                                <Box flex={1} minWidth={0}>
                                                    <Box display="flex" alignItems="center" gap={1}>
                                                        <Typography fontSize={14} fontWeight={600} color="var(--bone)" noWrap>
                                                            {held.tokenName ?? held.token?.tokenName ?? `${held.tokenAddress.slice(0, 6)}...${held.tokenAddress.slice(-4)}`}
                                                        </Typography>
                                                        <Typography fontSize={12} color="#6F6F68" fontFamily="var(--font-data)">{held.tokenSymbol ?? held.token?.tokenSymbol}</Typography>
                                                        {held.network && (
                                                            <img src={`/networks/${held.network}.svg`} height={14} alt="" />
                                                        )}
                                                    </Box>
                                                    <Typography fontSize={12} color="#8C8C85" fontFamily="var(--font-data)" mt={0.3}>
                                                        {priceFormatter(held.tokenAmount, 2, true, true)} tokens
                                                    </Typography>
                                                </Box>
                                                <Box display="flex" flexDirection="column" alignItems="flex-end" gap={0.3} flexShrink={0}>
                                                    {(held.token?.marketcap ?? held.marketcap) > 0 && (
                                                        <Typography fontSize={12} color="#BFD143" fontWeight={600} fontFamily="var(--font-data)">
                                                            MC ${priceFormatter(held.token?.marketcap ?? held.marketcap, 2)}
                                                        </Typography>
                                                    )}
                                                </Box>
                                            </ItemCard>
                                        </Link>
                                    ))}
                                </Box>
                                : <EmptyStateComponent icon={<DiamondIcon sx={{ fontSize: 32, color: 'var(--muted)' }} />} title="No holdings yet" description="Buy tokens to start building your collection" />
                    )}

                    {/* Replies */}
                    {tab === 2 && (
                        !profile
                            ? <ListSkeleton count={3} />
                            : profile.replies?.length > 0
                                ? profile.replies.map((reply: any) => (
                                    <ItemCard key={reply.id}>
                                        <Box flex={1} minWidth={0}>
                                            <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                                                <Typography fontSize={11} color="#BFD143" fontWeight={500} fontFamily="var(--font-data)">
                                                    {reply.tokenAddress ? `${reply.tokenAddress.slice(0, 6)}...${reply.tokenAddress.slice(-4)}` : 'Token'}
                                                </Typography>
                                                <Typography fontSize={11} color="#6F6F68" fontFamily="var(--font-data)">
                                                    {new Date(reply.date).toLocaleDateString()} {new Date(reply.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </Typography>
                                            </Box>
                                            <Typography fontSize={13} color="var(--bone)" sx={{ wordBreak: 'break-word' }}>{reply.comment}</Typography>
                                        </Box>
                                    </ItemCard>
                                ))
                                : <EmptyStateComponent icon={<ChatBubbleOutlineIcon sx={{ fontSize: 32, color: 'var(--muted)' }} />} title="No replies yet" description="Join the conversation on token pages" />
                    )}

                    {/* Followers */}
                    {tab === 3 && (
                        !profile
                            ? <ListSkeleton count={3} />
                            : Array.isArray(profile.followers) && profile.followers.length > 0
                                ? profile.followers.map((f: any) => {
                                    const addr = f.followerId ?? f.address
                                    return (
                                        <Link key={addr} href={`/profile?address=${addr}`} style={{ textDecoration: 'none' }}>
                                            <ItemCard>
                                                <UserAvatar user={f.user ?? f} address={addr} size={36} mr="0" />
                                                <Box flex={1} minWidth={0}>
                                                    <UserName user={f.user ?? f} address={addr} fontSize={14} color="var(--bone)" />
                                                    <Typography fontSize={12} color="#6F6F68" fontFamily="var(--font-data)">
                                                        {addr?.slice(0, 6)}...{addr?.slice(-4)}
                                                    </Typography>
                                                </Box>
                                            </ItemCard>
                                        </Link>
                                    )
                                })
                                : (profile?.followerCount ?? 0) > 0
                                    ? <Box display="flex" flexDirection="column" alignItems="center" py={4} gap={1}>
                                        <Typography fontSize={32} fontWeight={700} color="var(--bone)" fontFamily="var(--font-display)">
                                            {profile.followerCount}
                                        </Typography>
                                        <Typography color="#6F6F68" fontSize={14}>followers</Typography>
                                    </Box>
                                    : <EmptyStateComponent icon={<GroupIcon sx={{ fontSize: 32, color: 'var(--muted)' }} />} title="No followers yet" description="Share your profile to grow your audience" />
                    )}

                    {/* Following */}
                    {tab === 4 && (
                        !profile
                            ? <ListSkeleton count={3} />
                            : profile.followees?.length > 0
                                ? profile.followees.map((f: any) => {
                                    const addr = f.followeeId ?? f.address
                                    return (
                                        <Link key={addr} href={`/profile?address=${addr}`} style={{ textDecoration: 'none' }}>
                                            <ItemCard>
                                                <UserAvatar user={f.user ?? f} address={addr} size={36} mr="0" />
                                                <Box flex={1} minWidth={0}>
                                                    <UserName user={f.user ?? f} address={addr} fontSize={14} color="var(--bone)" />
                                                    <Typography fontSize={12} color="#6F6F68" fontFamily="var(--font-data)">
                                                        {addr?.slice(0, 6)}...{addr?.slice(-4)}
                                                    </Typography>
                                                </Box>
                                            </ItemCard>
                                        </Link>
                                    )
                                })
                                : <EmptyStateComponent icon={<SearchIcon sx={{ fontSize: 32, color: 'var(--muted)' }} />} title="Not following anyone" description="Discover and follow other traders" />
                    )}
                </Box>
            </Box>
        </PageBox>
    )
}
