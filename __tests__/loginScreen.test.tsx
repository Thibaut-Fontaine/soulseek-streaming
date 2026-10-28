/** Login screen: sign-in and account creation. */
import React from 'react';
import { Text, TextInput } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

jest.mock('react-native-linear-gradient', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: View };
});
jest.mock('react-native-svg', () => {
  const { View } = require('react-native');
  const { createElement } = require('react');
  const Svg = (props: object) => createElement(View, props);
  return { __esModule: true, default: Svg, Circle: Svg, G: Svg, Path: Svg, Rect: Svg };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
}));
jest.mock('react-native-track-player', () => ({ __esModule: true, default: {} }));
jest.mock('react-native-keychain', () => ({}));
jest.mock('../src/transport/rnTcpTransport', () => ({ ReactNativeTransport: class {} }));
jest.mock('../src/player/player', () => ({
  ensurePlayer: jest.fn(async () => {}),
  resetPlayer: jest.fn(async () => {}),
}));

import { useAppStore } from '../src/state/store';
import { LoginScreen } from '../src/ui/LoginScreen';

const login = jest.fn(async () => false);

function render(): ReactTestRenderer.ReactTestRenderer {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<LoginScreen />);
  });
  return renderer;
}

function texts(renderer: ReactTestRenderer.ReactTestRenderer): string {
  return renderer.root
    .findAllByType(Text)
    .map(node => [node.props.children].flat().filter(part => typeof part === 'string').join(''))
    .join(' | ');
}

function type(renderer: ReactTestRenderer.ReactTestRenderer, label: string, value: string) {
  const input = renderer.root.findAll(node => node.type === TextInput && node.props.accessibilityLabel === label)[0];
  act(() => input.props.onChangeText(value));
}

function press(renderer: ReactTestRenderer.ReactTestRenderer, text: string) {
  const target = renderer.root.findAll(
    node => typeof node.props.onPress === 'function' && texts({ root: node } as never).includes(text),
  );
  return act(async () => {
    await target[target.length - 1].props.onPress();
  });
}

beforeEach(() => {
  login.mockClear();
  useAppStore.setState({
    login,
    connection: 'idle',
    connectionError: null,
    loginRejection: null,
    prefillUsername: '',
  });
});

test('creating an account asks for the password twice', async () => {
  const screen = render();
  await press(screen, 'Pas encore de compte ? Créer un compte');

  expect(texts(screen)).toContain('Créer un compte');
  expect(texts(screen)).toContain('ne peut pas être récupéré');

  type(screen, "Nom d'utilisateur", 'new_listener');
  type(screen, 'Mot de passe', 'secret-1');
  type(screen, 'Confirmer le mot de passe', 'secret-2');
  await press(screen, 'Créer le compte');

  expect(login).not.toHaveBeenCalled();
  expect(texts(screen)).toContain('ne sont pas identiques');

  type(screen, 'Confirmer le mot de passe', 'secret-1');
  await press(screen, 'Créer le compte');
  expect(login).toHaveBeenCalledWith('new_listener', 'secret-1');
});

test('a name the server refuses is explained before any login', async () => {
  const screen = render();
  await press(screen, 'Pas encore de compte ? Créer un compte');

  type(screen, "Nom d'utilisateur", 'Élodie');
  type(screen, 'Mot de passe', 'pw');
  type(screen, 'Confirmer le mot de passe', 'pw');
  await press(screen, 'Créer le compte');

  expect(login).not.toHaveBeenCalled();
  expect(texts(screen)).toContain('accents');
});

test('a taken name says so, instead of "wrong password"', async () => {
  const screen = render();
  await press(screen, 'Pas encore de compte ? Créer un compte');

  act(() => {
    useAppStore.setState({
      connection: 'error',
      connectionError: 'Mot de passe incorrect',
      loginRejection: 'INVALIDPASS',
    });
  });
  expect(texts(screen)).toContain('déjà utilisé');

  await press(screen, 'Déjà un compte ? Se connecter');
  expect(texts(screen)).toContain('Mot de passe incorrect');
});
