import { Box, Typography } from "@mui/material"
import { styled } from "@mui/system"
import { useState } from "react"
import CheckIcon from '@mui/icons-material/Check';
import ArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';

const ComboBoxRoot = styled(Box)`
  width: fit-content;
  & > label {
    padding: 8px 16px;
    height: 100%;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    color: white;
    cursor: pointer;
    transition: all 0.2s ease;
    &:hover {
      border-color: rgba(209, 255, 26, 0.25);
      background: rgba(255, 255, 255, 0.06);
    }
  }
  position: relative;
  & .overlay {
    position: fixed;
    top:0; left:0; right:0; bottom:0;
    z-index: 3;
  }
  & .menu {
    position: absolute;
    top:calc(100% + 6px); right:0;
    border-radius: 12px;
    min-width: calc(100% - 2px);
    box-sizing: border-box;
    z-index: 3;
  }
  & ul {
    background: rgba(13, 13, 20, 0.95);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    list-style: none;
    padding: 4px;
    margin: 0;
    border-radius: 12px;
    color: #222;
    font-family: Inter;
    font-size: 13px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
    li {
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: #94A3B8;
      cursor: pointer;
      padding: 8px 12px;
      border-radius: 8px;
      transition: all 0.15s ease;
      &.active {
        color: white;
        font-weight: 600;
      }
      &:hover {
        color: white;
        background: rgba(255, 255, 255, 0.06);
      }
    }
  }
  ${({ theme }) => theme.breakpoints.down("sm")} {
    & > label {
      padding: 10px 16px;
    }
  }

  ${({ theme }) => theme.breakpoints.down(800)} {
    width: 100%;
    & > label {
      border-radius: 10px;
    }
  }
`

export default function ComboBox(props: any) {
    const [open, setOpen] = useState(false)
    return <ComboBoxRoot onClick={() => setOpen(!open)}>
        <Box component="label" {...props} display="flex" gap="4px" alignItems="center">
            <Typography component="span" fontSize={14}>{props.label}: </Typography>
            <Typography component="span" fontSize={14}>{props.values[props.value]}</Typography>
            <ArrowDownIcon sx={{ ml: 'auto' }} />
        </Box>
        {
            open &&
            <>
                <div className="overlay" onClick={() => setOpen(false)} />
                <Box className="menu">
                    <ul>
                        {
                            Object.entries(props.values)?.map(([key, label]: [string, any]) =>
                                <li key={key} className={key === props.value ? 'active' : ''} onClick={() => {
                                    props.onChange?.(key)
                                    setOpen(false)
                                }}>
                                    {label}
                                    {
                                        key === props.value && <CheckIcon sx={{ height: 18 }} />
                                    }
                                </li>
                            )
                        }
                    </ul>
                </Box>
            </>
        }
    </ComboBoxRoot>
}