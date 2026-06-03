"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Loader2, Check } from "lucide-react"

interface AnimatedStatusBadgeProps {
  trigger: boolean
  onAnimationComplete?: () => void
  className?: string
}

export function AnimatedStatusBadge({ 
  trigger, 
  onAnimationComplete,
  className = ""
}: AnimatedStatusBadgeProps) {
  const [isAnimating, setIsAnimating] = useState(false)
  const [isCompleted, setIsCompleted] = useState(false)

  const startAnimation = () => {
    setIsAnimating(true)
    setIsCompleted(false)
    setTimeout(() => {
      setIsAnimating(false)
      setTimeout(() => {
        setIsCompleted(true)
        // Make completed badge disappear after 3 seconds
        setTimeout(() => {
          setIsCompleted(false)
          if (onAnimationComplete) {
            onAnimationComplete()
          }
        }, 3000)
      }, 300) // Delay the appearance of "Completed" badge
    }, 3000) // Animation duration
  }

  useEffect(() => {
    if (!isAnimating && !isCompleted) {
      setIsCompleted(false)
    }
  }, [isAnimating, isCompleted])

  useEffect(() => {
    if (trigger) {
      startAnimation()
    }
  }, [trigger])

  return (
    <>
      <AnimatePresence>
        {isAnimating && (
          <motion.div
            className={`absolute top-0 right-0 bg-yellow-100 text-yellow-600 text-xs font-medium px-2.5 py-0.5 rounded flex items-center space-x-1 shadow-md border border-yellow-300/50 z-0 ${className}`}
            initial={{ y: 40, opacity: 1 }}
            animate={{ y: -32, opacity: 1 }}
            exit={{
              y: [-37, 40], // First go up 5px, then slide down
              opacity: [1, 1, 0], // Maintain opacity until the end of the animation
              scale: [1, 0.8, 0.8], // Scale down as it starts to disappear
            }}
            transition={{
              duration: 0.5,
              times: [0, 0.2, 1], // Timing for the exit animation stages
              ease: "easeInOut",
            }}
          >
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
            <span>Running</span>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {isCompleted && (
          <motion.div
            className={`absolute top-0 right-0 bg-green-100 text-green-600 text-xs font-medium px-2.5 py-0.5 rounded flex items-center space-x-1 shadow-md border border-green-300/50 z-0 ${className}`}
            initial={{ y: 40, opacity: 1 }}
            animate={{ y: -32, opacity: 1 }}
            exit={{
              y: [-37, 40], // First go up 5px, then slide down
              opacity: [1, 1, 0], // Maintain opacity until the end of the animation
              scale: [1, 0.8, 0.8], // Scale down as it starts to disappear
            }}
            transition={{
              duration: 0.5,
              times: [0, 0.2, 1], // Timing for the exit animation stages
              ease: "easeInOut",
            }}
          >
            <Check className="h-3 w-3 mr-1" />
            <span>Completed</span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
