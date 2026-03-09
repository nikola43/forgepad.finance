'use client'
import { Box, styled, keyframes } from "@mui/material";

// Shimmer animation
const shimmer = keyframes`
  0% { background-position: -400px 0; }
  100% { background-position: 400px 0; }
`;

// Pulse animation
const pulse = keyframes`
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
`;

// Base skeleton with shimmer
const SkeletonBase = styled(Box)`
  background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 75%);
  background-size: 800px 100%;
  animation: ${shimmer} 1.5s infinite linear;
  border-radius: 8px;
`;

// Skeleton for token cards in "trends" mode (small vertical cards)
export function TokenCardSkeleton({ mode = "list" }: { mode?: "trends" | "list" }) {
  if (mode === "trends") {
    return (
      <Box sx={{
        borderRadius: '16px',
        border: '1px solid rgba(255,255,255,0.05)',
        background: 'rgba(13,13,20,0.6)',
        p: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        height: '100%',
      }}>
        <SkeletonBase sx={{ width: '150px', height: '150px', mx: 'auto', borderRadius: '8px' }} />
        <SkeletonBase sx={{ width: '60%', height: '14px', mt: 1 }} />
        <SkeletonBase sx={{ width: '40%', height: '12px' }} />
        <Box display="flex" justifyContent="space-between" mt={2}>
          <SkeletonBase sx={{ width: '60px', height: '12px' }} />
          <SkeletonBase sx={{ width: '40px', height: '12px' }} />
        </Box>
        <Box display="flex" justifyContent="space-between">
          <SkeletonBase sx={{ width: '70px', height: '12px' }} />
          <SkeletonBase sx={{ width: '50px', height: '12px' }} />
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{
      borderRadius: '16px',
      border: '1px solid rgba(255,255,255,0.05)',
      background: 'rgba(13,13,20,0.6)',
      p: '8px 16px 8px 8px',
      display: 'flex',
      gap: '8px',
      height: '100%',
    }}>
      <Box display="flex" flexDirection="column" alignItems="center" gap="8px">
        <SkeletonBase sx={{ width: '64px', height: '64px', borderRadius: '8px', m: '4px' }} />
        <Box display="flex" gap="4px">
          <SkeletonBase sx={{ width: '16px', height: '16px', borderRadius: '50%' }} />
          <SkeletonBase sx={{ width: '36px', height: '16px', borderRadius: '10px' }} />
        </Box>
      </Box>
      <Box flex={1}>
        <Box display="flex" gap="8px" alignItems="center" mt={0.5}>
          <SkeletonBase sx={{ width: '100px', height: '14px' }} />
          <SkeletonBase sx={{ width: '40px', height: '12px' }} />
        </Box>
        <Box display="flex" justifyContent="space-between" mt={1} ml={1}>
          <SkeletonBase sx={{ width: '70px', height: '12px' }} />
          <SkeletonBase sx={{ width: '60px', height: '12px' }} />
        </Box>
        <Box display="flex" justifyContent="space-between" mt={0.5} ml={1}>
          <SkeletonBase sx={{ width: '70px', height: '12px' }} />
          <SkeletonBase sx={{ width: '50px', height: '12px' }} />
        </Box>
        <SkeletonBase sx={{ width: '100%', height: '4px', mt: 1, borderRadius: '100px' }} />
      </Box>
    </Box>
  );
}

// Skeleton for king card
export function KingCardSkeleton() {
  return (
    <Box sx={{
      borderRadius: '20px',
      background: 'linear-gradient(135deg, rgba(255,166,0,0.04) 0%, rgba(139,92,246,0.03) 50%, rgba(255,166,0,0.02) 100%)',
      border: '1px solid rgba(255,166,0,0.1)',
      p: '24px',
      display: 'flex',
      alignItems: 'center',
      gap: '20px',
    }}>
      <SkeletonBase sx={{ width: '80px', height: '80px', borderRadius: '12px', flexShrink: 0 }} />
      <Box flex={1}>
        <Box display="flex" gap="8px" alignItems="center">
          <SkeletonBase sx={{ width: '140px', height: '22px' }} />
          <SkeletonBase sx={{ width: '60px', height: '14px' }} />
        </Box>
        <Box display="flex" gap="16px" mt={1}>
          <Box>
            <SkeletonBase sx={{ width: '70px', height: '10px', mb: 0.5 }} />
            <SkeletonBase sx={{ width: '90px', height: '20px' }} />
          </Box>
          <Box sx={{ width: '1px', height: 32, background: 'rgba(255,255,255,0.08)' }} />
          <Box>
            <SkeletonBase sx={{ width: '50px', height: '10px', mb: 0.5 }} />
            <SkeletonBase sx={{ width: '70px', height: '14px' }} />
          </Box>
        </Box>
      </Box>
      <SkeletonBase sx={{ width: '60px', height: '32px', borderRadius: '10px', flexShrink: 0 }} />
    </Box>
  );
}

// Skeleton for profile page
export function ProfileSkeleton() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 4 }}>
      <SkeletonBase sx={{ width: '100px', height: '100px', borderRadius: '50%' }} />
      <SkeletonBase sx={{ width: '140px', height: '20px' }} />
      <SkeletonBase sx={{ width: '300px', height: '14px' }} />
      <Box display="flex" gap={3} mt={1}>
        {[1,2,3,4].map(i => (
          <Box key={i} textAlign="center">
            <SkeletonBase sx={{ width: '40px', height: '20px', mx: 'auto', mb: 0.5 }} />
            <SkeletonBase sx={{ width: '60px', height: '12px' }} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// Generic content skeleton (for lists)
export function ListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <Box display="flex" flexDirection="column" gap={2}>
      {Array.from({ length: count }).map((_, i) => (
        <Box key={i} display="flex" gap={2} alignItems="center" sx={{
          p: 2,
          borderRadius: '12px',
          border: '1px solid rgba(255,255,255,0.05)',
          background: 'rgba(13,13,20,0.4)',
        }}>
          <SkeletonBase sx={{ width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0 }} />
          <Box flex={1}>
            <SkeletonBase sx={{ width: '60%', height: '14px', mb: 1 }} />
            <SkeletonBase sx={{ width: '40%', height: '12px' }} />
          </Box>
          <SkeletonBase sx={{ width: '60px', height: '28px', borderRadius: '8px' }} />
        </Box>
      ))}
    </Box>
  );
}

// Export SkeletonBase for custom usage
export { SkeletonBase };
