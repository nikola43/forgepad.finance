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
    background: #232325;
    border-radius: 16px;
    color: white;
    cursor: pointer;
    &:hover {
      opacity: 0.7;
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
    border-radius: 10px;
    min-width: calc(100% - 2px);
    box-sizing: border-box;
    z-index: 3;
  }
  & ul {
    background: #232325;
    border: 1px solid #FF9D00;
    list-style: none;
    padding: 0.4em 0;
    margin: 0;
    border-radius: 4px;
    color: #222;
    font-family: Inter;
    font-size: 14px;
    li {
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: #ddd;
      cursor: pointer;
      padding: 0.4em 1em;
      &.active {
        color: white;
        font-weight: bold;
      }
      &:hover {
        color: black;
        background: #ddd;
      }
      
    }
  }
  ${({ theme }) => theme.breakpoints.down("sm")} {
    & > label {
      padding: 12px 16px;
    }
  }
    
  ${({ theme }) => theme.breakpoints.down(800)} {
    width: 100%;
    & > label {
      border-radius: 4px;
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