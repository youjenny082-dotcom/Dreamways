import { lazy, Suspense } from 'react';
import { AppProvider } from '@/context/AppContext';
import { useLenis } from '@/hooks/useLenis';
import VideoBackground from '@/sections/VideoBackground';
import ParticleCanvas from '@/sections/ParticleCanvas';
import Navbar from '@/sections/Navbar';
import TimeSlider from '@/sections/TimeSlider';
import Hero from '@/sections/Hero';
import About from '@/sections/About';
import Companions from '@/sections/Companions';
import Seasons from '@/sections/Seasons';
import Footer from '@/sections/Footer';

const BirdModelPreview = lazy(() => import('@/components/BirdModelPreview'));
const DepartureScene = lazy(() => import('@/components/DepartureScene'));

function AppContent() {
  useLenis();

  return (
    <>
      {/* Background layers */}
      <VideoBackground />
      <div className="vignette-overlay" />
      <ParticleCanvas />

      {/* Fixed UI */}
      <Navbar />
      <TimeSlider />

      {/* Page content */}
      <main className="relative z-10">
        <Hero />
        <About />
        <Companions />
        <Seasons />
        <Footer />
      </main>
    </>
  );
}

export default function App() {
  if (new URLSearchParams(window.location.search).get('preview') === 'bird') {
    return <Suspense fallback={<div style={{ padding: '3rem' }}>正在打开小鸟预览…</div>}><BirdModelPreview /></Suspense>;
  }

  if (new URLSearchParams(window.location.search).get('preview') !== 'original') {
    return <Suspense fallback={<div style={{ minHeight: '100vh', background: '#f3eddd', color: '#454b3c', padding: '3rem' }}>正在走进林缘…</div>}><DepartureScene /></Suspense>;
  }

  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

