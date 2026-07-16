'use client'

import * as React from 'react'
import { styled, Theme, CSSObject } from '@mui/material/styles'
import MuiDrawer from '@mui/material/Drawer'
import Box from '@mui/material/Box'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import IconButton from '@mui/material/IconButton'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import HomeIcon from '@mui/icons-material/Home'
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents'
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline'
import PersonOutlineIcon from '@mui/icons-material/PersonOutline'
import TrackChangesIcon from '@mui/icons-material/TrackChanges'
import GroupAddOutlinedIcon from '@mui/icons-material/GroupAddOutlined'
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined'
import StarBorderIcon from '@mui/icons-material/StarBorder'
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined'
import MilitaryTechOutlinedIcon from '@mui/icons-material/MilitaryTechOutlined'
import RedeemOutlinedIcon from '@mui/icons-material/RedeemOutlined'
import WorkspacePremiumOutlinedIcon from '@mui/icons-material/WorkspacePremiumOutlined'
import TravelExploreOutlinedIcon from '@mui/icons-material/TravelExploreOutlined'
import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined'
import SportsEsportsOutlinedIcon from '@mui/icons-material/SportsEsportsOutlined'
import { usePathname, useRouter } from 'next/navigation'

const drawerWidth = 240
const HEADER = 64

const paperBase = {
    top: HEADER,
    height: `calc(100% - ${HEADER}px)`,
    background: 'rgba(6, 6, 10, 0.96)',
    backdropFilter: 'blur(20px)',
    borderRight: '1px solid rgba(255,255,255,0.06)',
}

const openedMixin = (theme: Theme): CSSObject => ({
    width: drawerWidth,
    transition: theme.transitions.create('width', {
        easing: theme.transitions.easing.sharp,
        duration: theme.transitions.duration.enteringScreen,
    }),
    overflowX: 'hidden',
})

const closedMixin = (theme: Theme): CSSObject => ({
    transition: theme.transitions.create('width', {
        easing: theme.transitions.easing.sharp,
        duration: theme.transitions.duration.leavingScreen,
    }),
    overflowX: 'hidden',
    width: `calc(${theme.spacing(8)} + 1px)`,
})

const Drawer = styled(MuiDrawer, { shouldForwardProp: (prop) => prop !== 'open' })(
    ({ theme, open }) => ({
        width: drawerWidth,
        flexShrink: 0,
        whiteSpace: 'nowrap',
        boxSizing: 'border-box',
        ...(open
            ? { ...openedMixin(theme), '& .MuiDrawer-paper': { ...openedMixin(theme), ...paperBase } }
            : { ...closedMixin(theme), '& .MuiDrawer-paper': { ...closedMixin(theme), ...paperBase } }),
    }),
)

type NavItem = { label: string; href: string; target?: string; icon: React.ReactNode }

// `target` overrides the navigation destination while `href` stays the active-
// state match (so /profile?address=me still highlights on /profile).
const items: NavItem[] = [
    { label: 'Home', href: '/', icon: <HomeIcon /> },
    { label: 'Discover', href: '/discover', icon: <TravelExploreOutlinedIcon /> },
    { label: 'Portfolio', href: '/portfolio', icon: <AccountBalanceWalletOutlinedIcon /> },
    { label: 'Leaderboard', href: '/leaderboard', icon: <EmojiEventsIcon /> },
    { label: 'Rewards', href: '/rewards', icon: <TrackChangesIcon /> },
    { label: 'Referrals', href: '/referrals', icon: <GroupAddOutlinedIcon /> },
    { label: 'Watchlist', href: '/watchlist', icon: <StarBorderIcon /> },
    { label: 'Hall of Kings', href: '/kings', icon: <MilitaryTechOutlinedIcon /> },
    { label: 'Tier', href: '/tier', icon: <WorkspacePremiumOutlinedIcon /> },
    { label: 'Create Token', href: '/create', icon: <AddCircleOutlineIcon /> },
    { label: 'Creator', href: '/creator', icon: <InsightsOutlinedIcon /> },
    { label: 'Profile', href: '/profile', target: '/profile?address=me', icon: <PersonOutlineIcon /> },
]

export default function AppSidebar({ open, onToggle }: { open: boolean; onToggle: () => void }) {
    const pathname = usePathname()
    const router = useRouter()

    return (
        <Drawer variant="permanent" open={open}>
            <Box sx={{ display: 'flex', justifyContent: open ? 'flex-end' : 'center', px: 1, py: 0.5 }}>
                <IconButton onClick={onToggle} size="small" sx={{ color: 'rgba(255,255,255,0.7)' }}>
                    {open ? <ChevronLeftIcon /> : <ChevronRightIcon />}
                </IconButton>
            </Box>
            <List sx={{ px: 0.5 }}>
                {items.map((item) => {
                    const active = pathname === item.href
                    return (
                        <ListItem key={item.href} disablePadding sx={{ display: 'block' }}>
                            <ListItemButton
                                onClick={() => router.push(item.target ?? item.href)}
                                sx={{
                                    minHeight: 48,
                                    px: 2,
                                    my: 0.25,
                                    borderRadius: '10px',
                                    justifyContent: open ? 'initial' : 'center',
                                    color: active ? '#0a0a0f' : 'rgba(255,255,255,0.8)',
                                    background: active ? 'linear-gradient(135deg, #D3FF24, #e4ff66)' : 'transparent',
                                    fontWeight: active ? 700 : 500,
                                    '&:hover': {
                                        background: active
                                            ? 'linear-gradient(135deg, #D3FF24, #e4ff66)'
                                            : 'rgba(209,255,26,0.1)',
                                        color: active ? '#0a0a0f' : '#e4ff66',
                                    },
                                }}
                            >
                                <ListItemIcon sx={{ minWidth: 0, mr: open ? 2 : 'auto', justifyContent: 'center', color: 'inherit' }}>
                                    {item.icon}
                                </ListItemIcon>
                                <ListItemText
                                    primary={item.label}
                                    primaryTypographyProps={{ fontSize: 14, fontWeight: 'inherit' }}
                                    sx={{ opacity: open ? 1 : 0, m: 0 }}
                                />
                            </ListItemButton>
                        </ListItem>
                    )
                })}
            </List>
        </Drawer>
    )
}
