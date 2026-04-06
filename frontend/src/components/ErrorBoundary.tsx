'use client'

import React from 'react'
import { Box, Button, Typography } from '@mui/material'

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <Box
          display="flex"
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          minHeight="60vh"
          gap={3}
          p={4}
          textAlign="center"
        >
          <Typography fontSize={48}>&#x1F6E0;&#xFE0F;</Typography>
          <Typography
            fontSize={24}
            fontWeight={700}
            fontFamily="'Space Grotesk', sans-serif"
            sx={{
              background: 'linear-gradient(135deg, #FFA600, #FFD700)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Something went wrong
          </Typography>
          <Typography fontSize={14} color="#94A3B8" maxWidth={400}>
            An unexpected error occurred. Try refreshing the page.
          </Typography>
          <Box display="flex" gap={2}>
            <Button
              variant="contained"
              color="primary"
              onClick={() => window.location.reload()}
              sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 600 }}
            >
              Refresh Page
            </Button>
            <Button
              variant="outlined"
              color="secondary"
              onClick={() => this.setState({ hasError: false, error: undefined })}
              sx={{ borderRadius: '12px', textTransform: 'none', fontWeight: 600 }}
            >
              Try Again
            </Button>
          </Box>
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <Box
              mt={2}
              p={2}
              borderRadius="12px"
              bgcolor="rgba(239, 68, 68, 0.08)"
              border="1px solid rgba(239, 68, 68, 0.15)"
              maxWidth={600}
              width="100%"
              textAlign="left"
            >
              <Typography fontSize={12} fontFamily="monospace" color="#EF4444" sx={{ wordBreak: 'break-all' }}>
                {this.state.error.message}
              </Typography>
            </Box>
          )}
        </Box>
      )
    }

    return this.props.children
  }
}
