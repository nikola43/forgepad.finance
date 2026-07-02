'use client'

import { useSearchParams } from "next/navigation"
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
import { type Provider as EVMProvider, useAppKitAccount, useAppKitProvider } from "@reown/appkit/react"
import { BrowserProvider } from "ethers"
import axios from "axios"
import toast from "react-hot-toast"

import PageBox from "@/components/layout/pageBox"
import { getProfilePic, UserAvatar, UserName } from "@/components/cards/user"
import TokenLogo from "@/components/tokenLogo"
import { ProfileSkeleton, ListSkeleton } from "@/components/Skeleton"
import EmptyStateComponent from "@/components/EmptyState"
import { useUserProfile } from "@/hooks/user"
import { API_ENDPOINT } from "@/config"
import { priceFormatter } from "@/utils/price"
import Link from "next/link"

const StatBox = styled(Box)<{ clickable?: number }>`
    text-align: center;
    padding: 16px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    flex: 1;
    min-width: 80px;
    cursor: ${({ clickable }) => clickable ? 'pointer' : 'default'};
    transition: all 0.2s ease;
    ${({ clickable }) => clickable ? `
        &:hover {
            background: rgba(255, 255, 255, 0.06);
            border-color: rgba(209, 255, 26, 0.2);
        }
    ` : ''}
`

const StyledTab = styled(Tab)`
    text-transform: none;
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 600;
    font-size: 14px;
    color: #64748B;
    min-height: 40px;
    &.Mui-selected {
        color: #D3FF24;
    }
`

const ItemCard = styled(Box)`
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    cursor: pointer;
    transition: all 0.2s ease;
    &:hover {
        background: rgba(255, 255, 255, 0.06);
        border-color: rgba(209, 255, 26, 0.2);
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
        background: rgba(255, 255, 255, 0.06);
        color: #94A3B8;
        border: 1px solid rgba(255, 255, 255, 0.1);
        &:hover {
            background: rgba(239, 68, 68, 0.1);
            border-color: rgba(239, 68, 68, 0.3);
            color: #EF4444;
        }
    ` : `
        background: linear-gradient(135deg, #D3FF24, #e4ff66);
        color: #0a0a0f;
        border: none;
        &:hover {
            box-shadow: 0 4px 16px rgba(209, 255, 26, 0.3);
        }
    `}
`

const LikeButton = styled(IconButton)`
    color: #64748B;
    transition: all 0.2s ease;
    &:hover {
        color: #EF4444;
    }
    &.liked {
        color: #EF4444;
    }
`

const ProgressBar = styled('div')<{ value: number }>`
    height: 3px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 100px;
    overflow: hidden;
    width: 100%;
    &::after {
        content: "";
        display: block;
        height: 100%;
        width: ${({ value }) => Math.min(100, value)}%;
        background: linear-gradient(90deg, #D3FF24, #e4ff66);
        border-radius: 100px;
    }
`

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

    const [tab, setTab] = useState(0)
    const [editing, setEditing] = useState(false)
    const [editUsername, setEditUsername] = useState('')
    const [editBio, setEditBio] = useState('')
    const [saving, setSaving] = useState(false)
    const [uploadingAvatar, setUploadingAvatar] = useState(false)
    const [copied, setCopied] = useState(false)
    const [followLoading, setFollowLoading] = useState(false)
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
                user: { username: editUsername, bio: editBio, avatar: user?.avatar || null },
                signature,
                msg
            })
            toast.success('Profile updated')
            setEditing(false)
            reloadProfile()
        } catch (err: any) {
            const errMsg = err?.response?.data?.error || err?.message || 'Update failed'
            toast.error(errMsg)
        } finally {
            setSaving(false)
        }
    }, [walletProvider, connectedAddress, editUsername, editBio, user, reloadProfile])

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
                    <Typography color="#64748B" fontSize={16}>
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
                background: 'linear-gradient(180deg, rgba(209,255,26,0.06) 0%, transparent 100%)',
                borderRadius: '24px',
                border: '1px solid rgba(209,255,26,0.08)',
                p: { xs: 3, sm: 4 },
                mb: 3,
                position: 'relative',
                overflow: 'hidden',
                '&::before': {
                    content: '""',
                    position: 'absolute',
                    top: 0,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: '300px',
                    height: '300px',
                    background: 'radial-gradient(circle, rgba(209,255,26,0.08) 0%, transparent 70%)',
                    pointerEvents: 'none',
                }
            }}>
                <Box display="flex" flexDirection={{ xs: 'column', sm: 'row' }} gap={3} alignItems={{ sm: 'flex-start' }}>
                    {/* Avatar */}
                    <AvatarWrapper onClick={isOwnProfile ? () => fileInputRef.current?.click() : undefined}>
                        <Avatar
                            src={profilePic}
                            sx={{ width: isMobile ? 80 : 100, height: isMobile ? 80 : 100, border: '2px solid rgba(209,255,26,0.3)' }}
                        />
                        {isOwnProfile && (
                            <AvatarOverlay className="avatar-overlay">
                                {uploadingAvatar
                                    ? <CircularProgress size={24} sx={{ color: 'white' }} />
                                    : <CameraAltIcon sx={{ color: 'white', fontSize: 28 }} />
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
                                    slotProps={{ input: { sx: { borderRadius: '10px', background: 'rgba(255,255,255,0.05)', color: 'white' } } }}
                                />
                                <TextField
                                    size="small"
                                    placeholder="Bio"
                                    multiline
                                    maxRows={3}
                                    value={editBio}
                                    onChange={e => setEditBio(e.target.value)}
                                    slotProps={{ input: { sx: { borderRadius: '10px', background: 'rgba(255,255,255,0.05)', color: 'white' } } }}
                                />
                                <Box display="flex" gap={1}>
                                    <Button
                                        size="small"
                                        variant="contained"
                                        disabled={saving}
                                        onClick={saveProfile}
                                        sx={{ borderRadius: '10px', textTransform: 'none', background: '#D3FF24', color: '#0a0a0f', fontWeight: 600, '&:hover': { background: '#e4ff66' } }}
                                    >
                                        {saving ? <CircularProgress size={16} sx={{ color: '#0a0a0f' }} /> : 'Save'}
                                    </Button>
                                    <Button
                                        size="small"
                                        onClick={() => setEditing(false)}
                                        sx={{ borderRadius: '10px', textTransform: 'none', color: '#94A3B8' }}
                                    >
                                        Cancel
                                    </Button>
                                </Box>
                            </Box>
                        ) : (
                            <>
                                <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                                    <Typography fontSize={{ xs: 20, sm: 24 }} fontWeight={700} color="white" fontFamily="'Space Grotesk', sans-serif" noWrap>
                                        {user?.username?.trim() || shortAddr}
                                    </Typography>
                                    {isOwnProfile && (
                                        <IconButton size="small" onClick={startEdit} sx={{ color: '#64748B', '&:hover': { color: '#D3FF24' } }}>
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
                                    <Typography fontSize={13} color="#64748B" fontFamily="monospace">{shortAddr}</Typography>
                                    <IconButton size="small" onClick={copyAddress} sx={{ color: '#64748B', p: 0.3 }}>
                                        {copied ? <CheckIcon sx={{ fontSize: 14, color: '#10B981' }} /> : <ContentCopyIcon sx={{ fontSize: 14 }} />}
                                    </IconButton>
                                    <IconButton size="small" onClick={() => {
                                        navigator.clipboard.writeText(`${window.location.origin}/profile?address=${profileAddress}`)
                                        toast.success('Profile link copied!')
                                    }} sx={{ color: '#64748B', p: 0.3 }}>
                                        <ShareIcon sx={{ fontSize: 16 }} />
                                    </IconButton>
                                    {(user?.likes ?? 0) > 0 && (
                                        <Box display="flex" alignItems="center" gap={0.3} ml={1}>
                                            <FavoriteIcon sx={{ fontSize: 13, color: '#EF4444' }} />
                                            <Typography fontSize={12} color="#EF4444" fontWeight={600}>{user.likes}</Typography>
                                        </Box>
                                    )}
                                </Box>
                                {user?.bio && (
                                    <Typography fontSize={14} color="#94A3B8" mt={1} sx={{ wordBreak: 'break-word' }}>
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
                            transform: 'translateY(-2px)',
                            borderColor: 'rgba(209,255,26,0.3)',
                            boxShadow: '0 4px 16px rgba(209,255,26,0.1)',
                        }
                    }}>
                        <Typography fontSize={20} fontWeight={700} color="white" fontFamily="'Space Grotesk', sans-serif">
                            {profile?.tokens?.length ?? 0}
                        </Typography>
                        <Typography fontSize={11} color="#64748B" fontWeight={500} textTransform="uppercase" letterSpacing="0.05em">Tokens</Typography>
                    </StatBox>
                    <StatBox className="animate-fade-in" clickable={1} onClick={() => setTab(1)} sx={{
                        transition: 'all 0.2s ease',
                        '&:hover': {
                            transform: 'translateY(-2px)',
                            borderColor: 'rgba(209,255,26,0.3)',
                            boxShadow: '0 4px 16px rgba(209,255,26,0.1)',
                        }
                    }}>
                        <Typography fontSize={20} fontWeight={700} color="white" fontFamily="'Space Grotesk', sans-serif">
                            {profile?.helds?.length ?? 0}
                        </Typography>
                        <Typography fontSize={11} color="#64748B" fontWeight={500} textTransform="uppercase" letterSpacing="0.05em">Holdings</Typography>
                    </StatBox>
                    <StatBox className="animate-fade-in" clickable={1} onClick={() => setTab(3)} sx={{
                        transition: 'all 0.2s ease',
                        '&:hover': {
                            transform: 'translateY(-2px)',
                            borderColor: 'rgba(209,255,26,0.3)',
                            boxShadow: '0 4px 16px rgba(209,255,26,0.1)',
                        }
                    }}>
                        <Typography fontSize={20} fontWeight={700} color="white" fontFamily="'Space Grotesk', sans-serif">
                            {profile?.followerCount ?? profile?.followers?.length ?? 0}
                        </Typography>
                        <Typography fontSize={11} color="#64748B" fontWeight={500} textTransform="uppercase" letterSpacing="0.05em">Followers</Typography>
                    </StatBox>
                    <StatBox className="animate-fade-in" clickable={1} onClick={() => setTab(4)} sx={{
                        transition: 'all 0.2s ease',
                        '&:hover': {
                            transform: 'translateY(-2px)',
                            borderColor: 'rgba(209,255,26,0.3)',
                            boxShadow: '0 4px 16px rgba(209,255,26,0.1)',
                        }
                    }}>
                        <Typography fontSize={20} fontWeight={700} color="white" fontFamily="'Space Grotesk', sans-serif">
                            {profile?.followeeCount ?? profile?.followees?.length ?? 0}
                        </Typography>
                        <Typography fontSize={11} color="#64748B" fontWeight={500} textTransform="uppercase" letterSpacing="0.05em">Following</Typography>
                    </StatBox>
                </Box>
            </Box>

            {/* Tabs */}
            <Box mt={3}>
                <Tabs
                    value={tab}
                    onChange={(_, v) => setTab(v)}
                    variant={isMobile ? "scrollable" : "standard"}
                    scrollButtons="auto"
                    sx={{ '& .MuiTabs-indicator': { background: '#D3FF24' }, minHeight: 40 }}
                >
                    <StyledTab label={`Created (${profile?.tokens?.length ?? 0})`} />
                    <StyledTab label={`Holdings (${profile?.helds?.length ?? 0})`} />
                    <StyledTab label={`Replies (${profile?.replies?.length ?? 0})`} />
                    <StyledTab label={`Followers (${profile?.followerCount ?? profile?.followers?.length ?? 0})`} />
                    <StyledTab label={`Following (${profile?.followeeCount ?? profile?.followees?.length ?? 0})`} />
                </Tabs>

                <Box key={tab} className="animate-fade-in" mt={2} display="flex" flexDirection="column" gap={1}>
                    {/* Created Tokens */}
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
                                                        <Typography fontSize={14} fontWeight={600} color="white" noWrap>{token.tokenName}</Typography>
                                                        <Typography fontSize={12} color="#64748B">{token.tokenSymbol}</Typography>
                                                        <img src={`/networks/${token.network}.svg`} height={14} alt="" />
                                                    </Box>
                                                    <Box display="flex" alignItems="center" gap={2} mt={0.5}>
                                                        <Typography fontSize={12} color="#e4ff66" fontWeight={600}>MC: ${priceFormatter(token.marketcap, 2)}</Typography>
                                                        {token.volume > 0 && (
                                                            <Typography fontSize={11} color="#64748B">Vol: ${priceFormatter(token.volume, 2, true, true)}</Typography>
                                                        )}
                                                    </Box>
                                                    {!token.launchedAt && token.progress !== undefined && (
                                                        <Box mt={0.5}>
                                                            <ProgressBar value={Number(token.progress ?? 0)} />
                                                        </Box>
                                                    )}
                                                </Box>
                                                {token.launchedAt ? (
                                                    <Box sx={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '8px', px: 1, py: 0.3 }}>
                                                        <Typography fontSize={11} fontWeight={600} color="#10B981">Launched</Typography>
                                                    </Box>
                                                ) : (
                                                    <Typography fontSize={11} color="#64748B">{Number(token.progress ?? 0).toFixed(1)}%</Typography>
                                                )}
                                            </ItemCard>
                                        </Link>
                                    ))}
                                </Box>
                                : <EmptyStateComponent icon="🚀" title="No tokens created yet" description="Create your first token and start building your portfolio" />
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
                                                        <Typography fontSize={14} fontWeight={600} color="white" noWrap>
                                                            {held.tokenName ?? held.token?.tokenName ?? `${held.tokenAddress.slice(0, 6)}...${held.tokenAddress.slice(-4)}`}
                                                        </Typography>
                                                        <Typography fontSize={12} color="#64748B">{held.tokenSymbol ?? held.token?.tokenSymbol}</Typography>
                                                        {held.network && (
                                                            <img src={`/networks/${held.network}.svg`} height={14} alt="" />
                                                        )}
                                                    </Box>
                                                    <Typography fontSize={12} color="#94A3B8" mt={0.3}>
                                                        {priceFormatter(held.tokenAmount, 2, true, true)} tokens
                                                    </Typography>
                                                </Box>
                                                <Box display="flex" flexDirection="column" alignItems="flex-end" gap={0.3} flexShrink={0}>
                                                    {(held.token?.marketcap ?? held.marketcap) > 0 && (
                                                        <Typography fontSize={12} color="#e4ff66" fontWeight={600}>
                                                            MC ${priceFormatter(held.token?.marketcap ?? held.marketcap, 2)}
                                                        </Typography>
                                                    )}
                                                </Box>
                                            </ItemCard>
                                        </Link>
                                    ))}
                                </Box>
                                : <EmptyStateComponent icon="💎" title="No holdings yet" description="Buy tokens to start building your collection" />
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
                                                <Typography fontSize={11} color="#D3FF24" fontWeight={500}>
                                                    {reply.tokenAddress ? `${reply.tokenAddress.slice(0, 6)}...${reply.tokenAddress.slice(-4)}` : 'Token'}
                                                </Typography>
                                                <Typography fontSize={11} color="#475569">
                                                    {new Date(reply.date).toLocaleDateString()} {new Date(reply.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </Typography>
                                            </Box>
                                            <Typography fontSize={13} color="white" sx={{ wordBreak: 'break-word' }}>{reply.comment}</Typography>
                                        </Box>
                                    </ItemCard>
                                ))
                                : <EmptyStateComponent icon="💬" title="No replies yet" description="Join the conversation on token pages" />
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
                                                    <UserName user={f.user ?? f} address={addr} fontSize={14} color="white" />
                                                    <Typography fontSize={12} color="#64748B" fontFamily="monospace">
                                                        {addr?.slice(0, 6)}...{addr?.slice(-4)}
                                                    </Typography>
                                                </Box>
                                            </ItemCard>
                                        </Link>
                                    )
                                })
                                : (profile?.followerCount ?? 0) > 0
                                    ? <Box display="flex" flexDirection="column" alignItems="center" py={4} gap={1}>
                                        <Typography fontSize={32} fontWeight={700} color="white" fontFamily="'Space Grotesk', sans-serif">
                                            {profile.followerCount}
                                        </Typography>
                                        <Typography color="#64748B" fontSize={14}>followers</Typography>
                                    </Box>
                                    : <EmptyStateComponent icon="👥" title="No followers yet" description="Share your profile to grow your audience" />
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
                                                    <UserName user={f.user ?? f} address={addr} fontSize={14} color="white" />
                                                    <Typography fontSize={12} color="#64748B" fontFamily="monospace">
                                                        {addr?.slice(0, 6)}...{addr?.slice(-4)}
                                                    </Typography>
                                                </Box>
                                            </ItemCard>
                                        </Link>
                                    )
                                })
                                : <EmptyStateComponent icon="🔍" title="Not following anyone" description="Discover and follow other traders" />
                    )}
                </Box>
            </Box>
        </PageBox>
    )
}