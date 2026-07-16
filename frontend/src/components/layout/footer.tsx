import styled from "styled-components"
import TwitterIcon from '@/assets/images/x.svg';
import { FYUZ_TWITTER_URL } from "@/config";
import { FyuzLockup } from "../brand/FyuzMark";
import Link from "next/link";
import Image from "next/image";

const FooterWrapper = styled.footer`
    position: relative;
    margin-top: 80px;
    border-top: 1px solid var(--border);
    background: var(--moss-black);
`

const FooterInner = styled.div`
    max-width: 1200px;
    margin: 0 auto;
    padding: 40px 24px 24px;
    display: flex;
    flex-direction: column;
    gap: 32px;
`

const FooterTop = styled.div`
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 40px;
    flex-wrap: wrap;

    @media (max-width: 600px) {
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 24px;
    }
`

const Brand = styled.div`
    display: flex;
    flex-direction: column;
    gap: 8px;

    .brand-tagline {
        font-size: 13px;
        color: var(--text-muted);
        max-width: 260px;
        line-height: 1.5;
    }
`

const FooterLinks = styled.div`
    display: flex;
    gap: 48px;
    flex-wrap: wrap;

    @media (max-width: 600px) {
        gap: 32px;
        justify-content: center;
    }
`

const LinkGroup = styled.div`
    display: flex;
    flex-direction: column;
    gap: 10px;

    /* Specimen label voice: mono, all-caps, tracked (§10). */
    .group-title {
        font-family: var(--font-data);
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 2px;
        color: var(--text-muted);
        margin-bottom: 4px;
    }

    a {
        font-size: 13px;
        color: var(--text-secondary);
        text-decoration: none;
        transition: color var(--micro) var(--ease-out);
        &:hover {
            color: var(--citron);
        }
    }
`

const SocialLinks = styled.div`
    display: flex;
    align-items: center;
    gap: 12px;

    a {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: 10px;
        background: rgba(234, 230, 218, 0.04);
        border: 1px solid var(--border);
        transition: background-color var(--micro) var(--ease-out),
                    border-color var(--micro) var(--ease-out),
                    transform var(--micro) var(--ease-out);

        &:hover {
            background: rgba(191, 209, 67, 0.1);
            border-color: var(--border-hover);
        }

        &:active {
            transform: scale(0.98);
        }
    }
`

const FooterBottom = styled.div`
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 20px;
    border-top: 1px solid var(--border);
    flex-wrap: wrap;
    gap: 12px;

    @media (max-width: 600px) {
        justify-content: center;
    }

    .copyright {
        font-size: 12px;
        color: var(--text-muted);
    }

    .built-with {
        font-family: var(--font-data);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 2px;
        color: var(--text-muted);
    }
`

export default function Footer() {
    return <FooterWrapper>
        <FooterInner>
            <FooterTop>
                <Brand>
                    <FyuzLockup size={22} />
                    <span className="brand-tagline">
                        The cultural launchpad where the internet fuses personalities, narratives and communities into live meme markets.
                    </span>
                    <SocialLinks>
                        <Link href={FYUZ_TWITTER_URL} target="_blank">
                            <Image src={TwitterIcon} width={16} height={16} alt="Twitter" />
                        </Link>
                    </SocialLinks>
                </Brand>

                <FooterLinks>
                    <LinkGroup>
                        <span className="group-title">Platform</span>
                        <Link href="/">Tonight&apos;s Card</Link>
                        <Link href="/create">Make a Match</Link>
                        <Link href="/profile">My Profile</Link>
                    </LinkGroup>
                    <LinkGroup>
                        <span className="group-title">Resources</span>
                        <Link href={FYUZ_TWITTER_URL} target="_blank">Twitter / X</Link>
                    </LinkGroup>
                </FooterLinks>
            </FooterTop>

            <FooterBottom>
                <span className="copyright">&copy; {new Date().getFullYear()} Fyuz. All rights reserved.</span>
                <span className="built-with">Two icons enter. One market leaves.</span>
            </FooterBottom>
        </FooterInner>
    </FooterWrapper>
}
