import { Box, styled } from "@mui/material";

const Toggle = styled(Box)<{ inner?: "true" }>`
    background: ${({inner}) => inner ? 'transparent' : 'rgba(255, 255, 255, 0.03)'};
    border: 1px solid ${({inner}) => inner ? 'transparent' : 'rgba(255, 255, 255, 0.06)'};
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    gap: 4px;
    padding: 3px;
    font-family: 'Inter';
    font-size: 13px;
    font-weight: 500;
    width: fit-content;
    white-space: nowrap;
    z-index: 1;
    & > div {
        padding: 8px 20px;
        border-radius: 8px;
        color: rgba(255, 255, 255, 0.5);
        text-align: center;
        flex: 1;
        transition: all 0.2s ease;
        &.active {
            background: linear-gradient(135deg, #FFA600, #FFD700);
            color: #0a0a0f;
            font-weight: 600;
            box-shadow: 0 2px 8px rgba(255, 166, 0, 0.2);
        }
        &:not(.active):hover {
            color: white;
            background: rgba(255, 255, 255, 0.05);
        }
        cursor: pointer;
    }
`
export default Toggle