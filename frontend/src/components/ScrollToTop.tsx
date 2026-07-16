'use client'

import { useEffect, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { IconButton, Fade } from '@mui/material'
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp'

export function ScrollRestoration() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [pathname, searchParams])

  return null
}

export function ScrollToTopButton() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <Fade in={visible}>
      <IconButton
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        sx={{
          position: 'fixed',
          bottom: { xs: 80, sm: 32 },
          right: 24,
          zIndex: 50,
          width: 44,
          height: 44,
          background: 'rgba(191, 209, 67, 0.15)',
          border: '1px solid rgba(191, 209, 67, 0.25)',
          color: 'var(--citron)',
          transition: 'all 0.25s ease',
          '&:hover': {
            background: 'rgba(191, 209, 67, 0.25)',
          },
          '&:active': {
            transform: 'scale(0.98)',
          },
        }}
      >
        <KeyboardArrowUpIcon />
      </IconButton>
    </Fade>
  )
}
