import { Box, styled } from "@mui/material"

const PageBox = styled(Box)`
  padding: 20px;
  padding-bottom: 40px;
  position: relative;
  box-sizing: border-box;
  max-width: 1440px;
  margin: 0 auto;
  width: 100%;
  ${props => props.theme.breakpoints.down("md")} {
    padding: 12px;
  }
  ${props => props.theme.breakpoints.down("sm")} {
    padding: 8px;
  }
`

export default PageBox