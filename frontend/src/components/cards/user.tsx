import { Avatar, Box, Typography } from "@mui/material";
import { FILE_ENDPOINT } from "@/config";
// import verifiedIcon from "@/assets/images/verified.png";
import SecurityIcon from '@mui/icons-material/Security';
import styled from "styled-components";

const Link = styled.div<{ to: string, target?: string }>``

export function UserAvatar({ user, address, size = 24, mr = "0.5rem", me = false, showAdmin = false }: any) {
    let profilePic = `https://api.multiavatar.com/${parseInt((user?.address ?? address)?.slice(-6) ?? '0', 16)}.png`
    if (user?.avatar === "bondingCurv") {
        profilePic = "/favicon.ico"
    } else if (user?.twitter_profile_picture) {
        profilePic = user.twitter_profile_picture
    } else if (user?.avatar) {
        profilePic = `${FILE_ENDPOINT}/${user.avatar}`
    }
    return (
        <Link to={`/profile/${me ? "me" : (user?.address ?? address)}`} style={{ textDecoration: 'none', position: 'relative' }}>
            <Avatar sx={{ width: size, height: size, mr }} src={profilePic} />
            {
                showAdmin && !!user?.admin?.id &&
                <SecurityIcon sx={{ position: 'absolute', right: -2, bottom: -2, height: size / 2, color: '#E12D85' }} />
            }
        </Link>
    )
}

export function UserName({ user, address, fontSize = 14, fontFamily, color = "#D9D9D9", prefix = "", postfix = "", me = false }: any) {
    let username = !!user?.username?.trim() ? user.username : `@${(user?.address ?? address)?.slice(-6) ?? 'unknown'}`
    if (user?.twitter_username) {
        username = `@${user.twitter_username}`
    }
    return (
        <Box display="flex" alignItems="center" gap="4px">
            <Link to={`/profile/${me ? "me" : (user?.address ?? address)}`} style={{ textDecoration: 'none' }}>
                <Typography color={color} noWrap fontFamily={fontFamily} fontSize={fontSize}>{prefix}{username}</Typography>
            </Link>
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