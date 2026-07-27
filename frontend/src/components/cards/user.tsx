import { Avatar, Box, Typography } from "@mui/material";
import { FILE_ENDPOINT } from "@/config";
import SecurityIcon from '@mui/icons-material/Security';
import NextLink from "next/link";

export function getProfilePic(user: any, address?: string) {
    if (user?.avatar === "bondingCurv") return "/images/logo.png"
    if (user?.twitter_profile_picture) return user.twitter_profile_picture
    if (user?.avatar) {
        if (user.avatar.startsWith("http")) return user.avatar
        return `${FILE_ENDPOINT}/${user.avatar}`
    }
    const seed = (user?.address ?? address ?? '0x0').slice(2, 12)
    return `https://api.dicebear.com/9.x/identicon/svg?seed=${seed}&backgroundColor=1a1a2e`
}

function profileHref(user: any, address?: string, me?: boolean) {
    const addr = me ? "me" : (user?.address ?? address)
    if (!addr) return '#'
    return addr === "me" ? `/profile?address=me` : `/profile?address=${addr}`
}

export function UserAvatar({ user, address, size = 24, mr = "0.5rem", me = false, showAdmin = false }: any) {
    const profilePic = getProfilePic(user, address)
    return (
        <NextLink href={profileHref(user, address, me)} style={{ textDecoration: 'none', position: 'relative', display: 'inline-flex' }}>
            <Avatar sx={{ width: size, height: size, mr }} src={profilePic} />
            {
                showAdmin && !!user?.admin?.id &&
                <SecurityIcon sx={{ position: 'absolute', right: -2, bottom: -2, height: size / 2, color: '#E12D85' }} />
            }
        </NextLink>
    )
}

export function UserName({ user, address, fontSize = 14, fontWeight, fontFamily, color = "#D9D9D9", prefix = "", postfix = "", me = false }: any) {
    // Precedence: the name the user chose > their X handle > address tail.
    // The X handle must never override a set username — users who set both
    // expect their chosen name to show, with the handle as a profile link only.
    const twitterHandle = user?.twitterUsername ?? user?.twitter_username
    let username = !!user?.username?.trim()
        ? user.username
        : twitterHandle
            ? `@${twitterHandle}`
            : `@${(user?.address ?? address)?.slice(-6) ?? 'unknown'}`
    return (
        <Box display="flex" alignItems="center" gap="4px">
            <NextLink href={profileHref(user, address, me)} style={{ textDecoration: 'none' }}>
                <Typography color={color} noWrap fontFamily={fontFamily} fontSize={fontSize} fontWeight={fontWeight}>{prefix}{username}</Typography>
            </NextLink>
        </Box>
    )
}

export function User(props: any) {
    return (
        <>
            <UserAvatar {...props} />
            <UserName {...props} />
        </>
    )
}

export function CreatorAvatar({ token, ...props }: any) {
    return <UserAvatar user={token?.user} address={token?.creatorAddress} {...props} />
}

export function CreatorName({ token, ...props }: any) {
    return <UserName user={token?.user} address={token?.creatorAddress} {...props} />
}

export function Creator(props: any) {
    return (
        <>
            <CreatorAvatar {...props} />
            <CreatorName {...props} />
        </>
    )
}
