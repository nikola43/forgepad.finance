import { Box, styled } from "@mui/material"

const PageBox = styled(Box)`
  padding: 16px;
  padding-bottom: 30px;
  position: relative;
  box-sizing: border-box;
  ${props => props.theme.breakpoints.down("md")} {
    padding: 8px;
  }
  ${props => props.theme.breakpoints.down("sm")} {
    padding: 8px;
  }
`

export default PageBox