import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { apiRequest, auth } from '../lib/backend';

type BoundaryState = { error: Error | null; attempt: number };
class AppErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ClearHead native render failed', error.message, info.componentStack);
    void this.reportClientError(error, info);
  }

  private async reportClientError(error: Error, info: ErrorInfo) {
    try {
      const errorType = ['TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError'].includes(error.name) ? error.name : 'Error';
      const fingerprint = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${errorType}:${(info.componentStack ?? '').slice(0, 2000)}`);
      const source = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';
      const session = (await auth?.auth.getSession())?.data.session;
      if (!session) return;
      await apiRequest('/telemetry/client-errors', { method: 'POST', body: JSON.stringify({ source, errorType, fingerprint }) }, session.user.id);
    } catch { /* Diagnostics must never interrupt the recovery screen. */ }
  }

  render() {
    if (this.state.error) return <SafeAreaView style={styles.fallback}><View><Text style={styles.eyebrow}>YOUR SPACE IS STILL HERE</Text><Text accessibilityRole="header" style={styles.title}>Let’s try that again.</Text><Text style={styles.copy}>A temporary issue interrupted this screen. If a thought was saved on this device, it remains available when you retry.</Text><Pressable accessibilityRole="button" onPress={() => this.setState((state) => ({ error: null, attempt: state.attempt + 1 }))} style={styles.button}><Text style={styles.buttonText}>Try again</Text></Pressable></View></SafeAreaView>;
    return <View key={this.state.attempt} style={styles.fill}>{this.props.children}</View>;
  }
}

export default function RootLayout() {
  return <><StatusBar style="dark" /><AppErrorBoundary><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#e7f1fe' } }} /></AppErrorBoundary></>;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#e7f1fe' },
  fallback: { flex: 1, justifyContent: 'center', backgroundColor: '#e7f1fe', padding: 28 },
  eyebrow: { color: '#0a78f5', fontSize: 11, fontWeight: '700', letterSpacing: 1.4, marginBottom: 16 },
  title: { color: '#011122', fontSize: 30, fontWeight: '600', letterSpacing: -1, marginBottom: 10 },
  copy: { color: '#064893', fontSize: 15, lineHeight: 23 },
  button: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a78f5', borderRadius: 14, marginTop: 24 },
  buttonText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
});
