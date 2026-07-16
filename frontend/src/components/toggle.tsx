import { Box, styled } from "@mui/material";

const Toggle = styled(Box)<{ inner?: "true" }>`
    background: ${({inner}) => inner ? 'transparent' : 'rgba(234, 230, 218, 0.03)'};
    border: 1px solid ${({inner}) => inner ? 'transparent' : 'rgba(234, 230, 218, 0.06)'};
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    gap: 4px;
    padding: 3px;
    font-family: var(--font-body);
    font-size: 13px;
    font-weight: 500;
    width: fit-content;
    white-space: nowrap;
    z-index: 1;
    & > div {
        padding: 8px 20px;
        border-radius: 8px;
        color: rgba(234, 230, 218, 0.5);
        text-align: center;
        flex: 1;
        transition: all 0.2s ease;
        cursor: pointer;
        &.active[data-tradetype="buy"] {
            background: var(--up);
            color: var(--moss-black);
            font-weight: 600;
        }
        &.active[data-tradetype="sell"] {
            background: var(--down);
            color: var(--moss-black);
            font-weight: 600;
        }
        &:not(.active):hover {
            color: var(--text-primary);
            background: rgba(234, 230, 218, 0.05);
        }
    }
`
export default Toggle