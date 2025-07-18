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
            <Toaster />
        </>
    );
}

export default MainLayout;
