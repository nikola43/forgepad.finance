'use client'

import { ReactNode, useEffect, useState } from "react";
import Header from "./header";
import Footer from "./footer";
import Sidebar from "./sidebar";
import { styled, useMediaQuery } from "@mui/material";
import MobileMenu from "./menu";
import imgBackground from "../../assets/images/bg.jpg"
import { Toaster } from "react-hot-toast"

const Main = styled('div')<{ minimized: boolean }>`
    position: relative;
    min-height: 100vh;
    margin-left: ${({ minimized }) => minimized ? '64px' : '212px'};
    background: #121212;
    // &::before {
    //     content: "";
    //     position: absolute;
    //     left: 0;
    //     top: 0;
    //     width: 100%;
    //     height: 100%;
    //     // background: url(${imgBackground}) no-repeat center/contain;
    //     background-attachment: fixed;
    //     filter: grayscale(1);
    //     // opacity: 0.1;
    //     // z-index: 1;
    // }
    ${({ theme }) => theme.breakpoints.down(800)} {
        margin-left: 0;
        padding-top: 72px;
        &::before {
            background-size: cover;
        }
    }
`

function MainLayout({ children }: { children: ReactNode }) {
    const [minimized, setMinimize] = useState(false)
    const [isMenuOpen, setMenuOpen] = useState(false)

    const isMobile = useMediaQuery('(max-width: 800px)')

    useEffect(() => {
        window.dispatchEvent(new Event('resize'))
    }, [minimized])

    return (
        <>
            <Main minimized={minimized}>
                <Header />
                { children }
                { !isMobile && <Footer /> }
            </Main>
            {
                isMobile
                ? <MobileMenu open={isMenuOpen} onMenuOpen={(isOpen) => setMenuOpen(isOpen)} />
                : <Sidebar minimized={minimized} setMinimize={setMinimize} />
            }
            <Toaster />
        </>
    );
}

export default MainLayout;
