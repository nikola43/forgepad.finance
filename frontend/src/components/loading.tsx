import { Box } from "@mui/material";
import styled, { keyframes } from "styled-components";

const rotate = keyframes`
  from {
    stroke-dashoffset: 0;
  }
  to {
    stroke-dashoffset: -359;
  }
`

const SpinBox = styled.div`
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100vw;
    height: 100vh;
    position: fixed;
    svg {
        rect {
            animation: ${rotate} 1s linear infinite;
        }
    }
`

export default function Loading() {
    return <SpinBox>
        <svg viewBox="0 0 110 110" width="100" height="100">
            <rect x="2" y="2" width="106" fill="none" stroke="white" strokeWidth="2" height="106" rx="20" strokeDasharray="134 263" />
        </svg>
    </SpinBox>
}