import styled from "styled-components"
import TwitterIcon from '@/assets/images/x.svg';
import { FORGE_TWITTER_URL } from "@/config";
import Link from "next/link";
import Image from "next/image";

const FooterWrapper = styled.footer`
    position: relative;
    margin-top: 80px;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
    background: linear-gradient(180deg, transparent 0%, rgba(6, 6, 10, 0.8) 100%);

    &::before {
        content: "";
        position: absolute;
        top: -1px;
        left: 10%;
        right: 10%;
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(209, 255, 26, 0.2), transparent);
    }
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

    .brand-name {
        font-family: 'Space Grotesk', sans-serif;
        font-size: 20px;
        font-weight: 700;
        background: linear-gradient(135deg, #D3FF24, #e4ff66);
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        letter-spacing: -0.02em;
    }

    .brand-tagline {
        font-size: 13px;
        color: #64748B;
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

    .group-title {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #64748B;
        margin-bottom: 4px;
    }

    a {
        font-size: 13px;
        color: #94A3B8;
        text-decoration: none;
        transition: color 0.2s ease;
        &:hover {
            color: #D3FF24;
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
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.06);
        transition: all 0.25s ease;

        &:hover {
            background: rgba(209, 255, 26, 0.1);
            border-color: rgba(209, 255, 26, 0.25);
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(209, 255, 26, 0.15);
        }
    }
`

const FooterBottom = styled.div`
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
    flex-wrap: wrap;
    gap: 12px;

    @media (max-width: 600px) {
        justify-content: center;
    }

    .copyright {
        font-size: 12px;
        color: #475569;
    }

    .built-with {
        font-size: 12px;
        color: #475569;
        display: flex;
        align-items: center;
        gap: 4px;

        .heart {
            color: #EF4444;
            animation: pulse 2s ease-in-out infinite;
        }
    }
`

export default function Footer() {
    return <FooterWrapper>
        <FooterInner>
            <FooterTop>
                <Brand>
                    <span className="brand-name">Arrowpad</span>
                    <span className="brand-tagline">
                        The token launchpad for Robinhood Chain. Launch on a fair bonding curve, trade instantly, and graduate to Uniswap.
                    </span>
                    <SocialLinks>
                        <Link href={FORGE_TWITTER_URL} target="_blank">
                            <Image src={TwitterIcon} width={16} height={16} alt="Twitter" />
                        </Link>
                    </SocialLinks>
                </Brand>

                <FooterLinks>
                    <LinkGroup>
                        <span className="group-title">Platform</span>
                        <Link href="/">Explore Tokens</Link>
                        <Link href="/create">Create Token</Link>
                        <Link href="/profile">My Profile</Link>
                    </LinkGroup>
                    <LinkGroup>
                        <span className="group-title">Resources</span>
                        <Link href={FORGE_TWITTER_URL} target="_blank">Twitter / X</Link>
                    </LinkGroup>
                </FooterLinks>
            </FooterTop>

            <FooterBottom>
                <span className="copyright">&copy; {new Date().getFullYear()} Arrowpad. All rights reserved.</span>
                <span className="built-with">Built with <span className="heart">&hearts;</span> on Robinhood Chain</span>
            </FooterBottom>
        </FooterInner>
    </FooterWrapper>
}
