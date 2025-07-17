import { Box, styled } from "@mui/material";

const Toggle = styled(Box)<{ inner?: "true" }>`
    background: ${({inner}) => inner ? 'transparent' : '#121212'};
    border-radius: 6px;
    overflow: hidden;
    display: flex;
    gap: 8px;
    font-family: 'Inter';
    font-size: 14px;
    width: fit-content;
    white-space: nowrap;
    z-index: 1;
    & > div {
        padding: 9px 24px;
        border-radius: ${({inner}) => inner ? '6px' : '0'};
        color: white;
        text-align: center;
        flex: 1;
        &.active {
            background: white;
            color: black;
            font-weight: bold;
        }
        cursor: pointer;
    }
`
export default Toggle