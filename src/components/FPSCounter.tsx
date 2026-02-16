import { useEffect, useState, useRef } from 'react';

export const FPSCounter = () => {
    const [fps, setFps] = useState(0);
    const framesRef = useRef(0);
    const lastTimeRef = useRef(performance.now());

    useEffect(() => {
        let animationFrameId: number;

        const loop = (time: number) => {
            framesRef.current++;
            if (time - lastTimeRef.current >= 1000) {
                setFps(Math.round((framesRef.current * 1000) / (time - lastTimeRef.current)));
                framesRef.current = 0;
                lastTimeRef.current = time;
            }
            animationFrameId = requestAnimationFrame(loop);
        };

        animationFrameId = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(animationFrameId);
    }, []);

    return (
        <div className="fps-counter">
            FPS: {fps}
        </div>
    );
};
