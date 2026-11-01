import { createSeniorMarker } from '../../shared/mapMarker.js';
import seniorAvatar from './assets/senior-nature.svg';

export function createFamilyMarker({ live, inside }) {
  const element = createSeniorMarker({ live, inside });
  element.querySelector('img').src = seniorAvatar;
  const dot = document.createElement('span');
  dot.style.cssText = `position:absolute;bottom:-5px;left:27px;width:17px;height:17px;border:3px solid white;border-radius:50%;background:${!live ? '#d97706' : inside ? '#00b785' : '#ef4444'};box-shadow:0 2px 5px #0002`;
  element.append(dot);
  return element;
}
