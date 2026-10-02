import { useEffect, useRef, useSyncExternalStore } from 'react';
import { BrowserLayoutChangeNotifier } from '../notifier';
import { LocalLayoutRepository } from '../repository';
import { BrowserStorageService } from '../storageService';
import { ExpoSketchViewModel } from '../viewModel';

export const useExpoSketchViewModel = () => {
  const viewModel = useRef<ExpoSketchViewModel | null>(null);
  if (!viewModel.current) {
    const notifier = new BrowserLayoutChangeNotifier();
    viewModel.current = new ExpoSketchViewModel(new LocalLayoutRepository(new BrowserStorageService()), notifier);
  }
  const vm = viewModel.current;
  const state = useSyncExternalStore(vm.subscribe.bind(vm), () => vm.state, () => vm.state);
  useEffect(() => {
    void vm.initialize();
    return () => vm.dispose();
  }, [vm]);
  return { state, vm };
};
