'use client'

import { ReactNode, useEffect, useState } from "react";
import Header from "./header";
import Footer from "./footer";
import Sidebar from "./sidebar";
import { styled, useMediaQuery } from "@mui/material";
import MobileMenu from "./menu";
import imgBackground from "../../assets/images/bg.jpg"
import { Toaster } from "react-hot-toast"

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

    const isMobile = useMediaQuery('(max-width: 800px)')

    return (
        <>
            <Main>
                <Header />
                { children }
                { !isMobile && <Footer /> }
            </Main>
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
