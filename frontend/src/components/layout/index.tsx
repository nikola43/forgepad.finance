'use client'

import { ReactNode, useEffect, useState, lazy, Suspense } from "react";
import Header from "./header";
import Footer from "./footer";
import AppSidebar from "./AppSidebar";
import { Box, styled, useMediaQuery } from "@mui/material";
import MobileMenu from "./menu";
import imgBackground from "../../assets/images/bg.jpg"
import { Toaster } from "react-hot-toast"
import ErrorBoundary from "@/components/ErrorBoundary"
import { ScrollRestoration, ScrollToTopButton } from "@/components/ScrollToTop"

const ParticleBackground = lazy(() => import("@/components/ParticleBackground"))

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
            <Suspense fallback={null}>
                <ParticleBackground />
            </Suspense>
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
                        background: 'rgba(13, 13, 20, 0.95)',
                        backdropFilter: 'blur(20px)',
                        color: '#F8FAFC',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '12px',
                        fontSize: '14px',
                        fontFamily: "'Inter', sans-serif",
                        padding: '12px 16px',
                        boxShadow: '0 16px 48px rgba(0, 0, 0, 0.5)',
                        maxWidth: '420px',
                    },
                    success: {
                        iconTheme: {
                            primary: '#10B981',
                            secondary: '#0a0a0f',
                        },
                        style: {
                            borderColor: 'rgba(16, 185, 129, 0.2)',
                        },
                    },
                    error: {
                        iconTheme: {
                            primary: '#EF4444',
                            secondary: '#0a0a0f',
                        },
                        style: {
                            borderColor: 'rgba(239, 68, 68, 0.2)',
                        },
                    },
                }}
            />
        </>
    );
}

export default MainLayout;
