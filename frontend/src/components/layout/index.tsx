'use client'

import { ReactNode, useEffect, useState } from "react";
import Header from "./header";
import Footer from "./footer";
import AppSidebar from "./AppSidebar";
import { Box, styled, useMediaQuery } from "@mui/material";
import MobileMenu from "./menu";
import { Toaster } from "react-hot-toast"
import ErrorBoundary from "@/components/ErrorBoundary"
import { ScrollRestoration, ScrollToTopButton } from "@/components/ScrollToTop"

// The chamber is the constant: moss black, flat (§11). The animated noise
// shader that used to sit here is retired — no noise, no glows, no 3D (§10).

const Main = styled('div')`
    position: relative;
    min-height: 100vh;
    padding-top: 90px;
    ${({ theme }) => theme.breakpoints.down(800)} {
        padding-top: 72px;
    }
`

function MainLayout({ children }: { children: ReactNode }) {
    const [isMenuOpen, setMenuOpen] = useState(false)
    const [sidebarOpen, setSidebarOpen] = useState(true)

    const isMobile = useMediaQuery('(max-width: 800px)')

    // Expose the current sidebar width so the fixed header can start to its right.
    useEffect(() => {
        const w = isMobile ? '0px' : (sidebarOpen ? '240px' : '65px')
        document.documentElement.style.setProperty('--sidebar-w', w)
    }, [isMobile, sidebarOpen])

    return (
        <>
            {isMobile ? (
                <Main>
                    <Header />
                    <ErrorBoundary>
                        <ScrollRestoration />
                        {children}
                    </ErrorBoundary>
                </Main>
            ) : (
                <Box sx={{ display: 'flex', alignItems: 'stretch' }}>
                    <AppSidebar open={sidebarOpen} onToggle={() => setSidebarOpen((o) => !o)} />
                    <Main style={{ flexGrow: 1, minWidth: 0, width: '100%' }}>
                        <Header />
                        <ErrorBoundary>
                            <ScrollRestoration />
                            {children}
                        </ErrorBoundary>
                        <Footer />
                    </Main>
                </Box>
            )}
            <ScrollToTopButton />
            {
                isMobile &&
                <MobileMenu open={isMenuOpen} onMenuOpen={(isOpen) => setMenuOpen(isOpen)} />
            }
            <Toaster
                position="top-right"
                toastOptions={{
                    duration: 5000,
                    style: {
                        background: '#1E1C10',
                        color: '#EAE6DA',
                        border: '1px solid rgba(234, 230, 218, 0.08)',
                        borderRadius: '12px',
                        fontSize: '14px',
                        fontFamily: "'Space Grotesk', Helvetica, Arial, sans-serif",
                        padding: '12px 16px',
                        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.6)',
                        maxWidth: '420px',
                    },
                    success: {
                        iconTheme: {
                            primary: '#3FA968',
                            secondary: '#131208',
                        },
                        style: {
                            borderColor: 'rgba(63, 169, 104, 0.4)',
                        },
                    },
                    error: {
                        iconTheme: {
                            primary: '#D64545',
                            secondary: '#131208',
                        },
                        style: {
                            borderColor: 'rgba(214, 69, 69, 0.4)',
                        },
                    },
                }}
            />
        </>
    );
}

export default MainLayout;
