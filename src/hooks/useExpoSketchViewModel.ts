import { useEffect, useRef, useSyncExternalStore } from 'react';
import { LocalLayoutRepository } from '../repository';
import { BrowserStorageService } from '../storageService';
import { ExpoSketchViewModel } from '../viewModel';

export const useExpoSketchViewModel = () => {
  const viewModel = useRef<ExpoSketchViewModel | null>(null);
  if (!viewModel.current) viewModel.current = new ExpoSketchViewModel(new LocalLayoutRepository(new BrowserStorageService()));
  const vm = viewModel.current;
  const state = useSyncExternalStore(vm.subscribe.bind(vm), () => vm.state, () => vm.state);
  useEffect(() => { void vm.initialize(); }, [vm]);
  return { state, vm };
};
