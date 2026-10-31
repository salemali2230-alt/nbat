/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { ImageScanner } from './components/ImageScanner';
import { IraqiPlantLibrary } from './components/IraqiPlantLibrary';
import { SavedReportsView } from './components/SavedReportsView';
import { PlantReportModal } from './components/PlantReportModal';
import { PlantData, SavedPlantReport } from './types/plant';
import { SamplePlantItem } from './data/samplePlants';
import { getSavedReports } from './utils/storage';
import { Sparkles, Heart } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'scanner' | 'library' | 'saved'>('scanner');
  const [savedReports, setSavedReports] = useState<SavedPlantReport[]>([]);
  const [activeReportPlant, setActiveReportPlant] = useState<{
    plant: PlantData;
    image: string;
    alreadySavedId?: string;
    initialNotes?: string;
    initialLocation?: string;
  } | null>(null);

  useEffect(() => {
    setSavedReports(getSavedReports());
  }, []);

  const handlePlantIdentified = (plant: PlantData, imageBase64: string) => {
    setActiveReportPlant({
      plant,
      image: imageBase64,
    });
  };

  const handleSelectSample = (sample: SamplePlantItem) => {
    setActiveReportPlant({
      plant: sample.data,
      image: sample.image,
    });
  };

  const handleOpenSavedReport = (report: SavedPlantReport) => {
    setActiveReportPlant({
      plant: report.plantData,
      image: report.imageDataUrl,
      alreadySavedId: report.id,
      initialNotes: report.userNotes,
      initialLocation: report.location,
    });
  };

  const handleSavedReportUpdated = () => {
    setSavedReports(getSavedReports());
  };

  return (
    <div dir="rtl" className="min-h-screen bg-stone-100 text-stone-900 flex flex-col font-sans antialiased selection:bg-emerald-500 selection:text-white">
      {/* Top Navigation */}
      <Navbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        savedCount={savedReports.length}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {activeTab === 'scanner' && (
          <ImageScanner
            onPlantIdentified={handlePlantIdentified}
            onSelectSamplePlant={handleSelectSample}
          />
        )}

        {activeTab === 'library' && (
          <IraqiPlantLibrary
            onSelectPlant={handleSelectSample}
          />
        )}

        {activeTab === 'saved' && (
          <SavedReportsView
            reports={savedReports}
            onReportsChange={setSavedReports}
            onOpenReport={handleOpenSavedReport}
            onNavigateToScanner={() => setActiveTab('scanner')}
          />
        )}
      </main>

      {/* Report Modal */}
      {activeReportPlant && (
        <PlantReportModal
          plant={activeReportPlant.plant}
          imageDataUrl={activeReportPlant.image}
          alreadySavedId={activeReportPlant.alreadySavedId}
          initialNotes={activeReportPlant.initialNotes}
          initialLocation={activeReportPlant.initialLocation}
          onClose={() => setActiveReportPlant(null)}
          onSaved={handleSavedReportUpdated}
        />
      )}

      {/* Footer */}
      <footer className="mt-auto border-t border-stone-200/80 bg-white py-6 px-4 print:hidden">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-stone-600 text-center sm:text-right">
          <div className="flex items-center gap-2">
            <span className="text-base">🇮🇶</span>
            <span>نباتاتي — دليل النباتات ورعايتها في البيئة العراقية بالذكاء الاصطناعي الكامل عبر الخادم.</span>
          </div>

          <div className="flex items-center justify-center gap-3 text-stone-600">
            <span className="inline-flex items-center gap-1 text-emerald-800 font-medium">
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              Gemini 3.8 Server-Side
            </span>
            <span>•</span>
            <span>صنع بحب للحدائق العراقية</span>
            <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500 inline" />
          </div>
        </div>
      </footer>
    </div>
  );
}
