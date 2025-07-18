import styled from "styled-components"
import TelegramIcon from '@/assets/images/telegram.svg';
import TwitterIcon from '@/assets/images/x.svg';
import { FORGE_TELEGRAM_URL, FORGE_TWITTER_URL } from "@/config";
import Link from "next/link";
import Image from "next/image";

const Flex = styled.div`
    display: flex;
    padding: 16px 24px;
    position: absolute;
    bottom: 0px;
    left: 0px;
    right: 0;
    align-items: center;
    justify-content: space-between;
    gap: 40px;
    color: #FFA600;
    font-family: Arial;
`

const Links = styled.ul`
    list-style: none;
    display: flex;
    padding: 0;
    margin: 0;
    li {
        padding: 0 2px;
        margin: 0;
        a {
            color: white;
        }
    }
`

const SocialLinks = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  opacity: 0.8;
`

export default function Footer() {
    return <Flex>
        <span>@ Forge 2025</span>
        {/* <Links>
            <li><Link to="/privacy">privacy policy</Link></li>
            <li>|</li>
            <li><Link to="/terms">terms of service</Link></li>
            <li>|</li>
            <li><Link to="/docs">docs</Link></li>
            <li>|</li>
            <li><Link to="/support">support</Link></li>
        </Links> */}
        <SocialLinks>
            <Link href={FORGE_TELEGRAM_URL} target="_blank"><Image src={TelegramIcon} width={24} height={24} alt="telegramCommunity" /></Link>
            <Link href={FORGE_TWITTER_URL} target="_blank"><Image src={TwitterIcon} width={20} height={20} alt="twitter" /></Link>
        </SocialLinks>
    </Flex>
}
