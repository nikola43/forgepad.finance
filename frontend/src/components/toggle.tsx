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
        cursor: pointer;
        &.active[data-tradetype="buy"] {
            background: linear-gradient(135deg, #10B981, #059669);
            color: white;
            font-weight: 600;
            box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
        }
        &.active[data-tradetype="sell"] {
            background: linear-gradient(135deg, #EF4444, #DC2626);
            color: white;
            font-weight: 600;
            box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);
        }
        &:not(.active):hover {
            color: white;
            background: rgba(255, 255, 255, 0.05);
        }
    }
`
export default Toggle