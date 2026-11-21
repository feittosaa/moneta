package br.com.moneta;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.os.Bundle;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.*;
import android.webkit.*;
import android.widget.TextView;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.Inet4Address;
import java.net.ServerSocket;
import java.net.BindException;
import java.net.URL;
import java.nio.file.Files;
import java.util.*;
import java.util.zip.*;
import org.json.JSONObject;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.Build;
import android.os.CancellationSignal;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public class MainActivity extends Activity {
    private WebView panel;
    private Process server;
    private String origin;
    private volatile boolean closed;
    private PermissionRequest camera;
    private ValueCallback<Uri[]> picker;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
        TextView loading = new TextView(this);
        loading.setGravity(android.view.Gravity.CENTER);
        loading.setText("Abrindo o cofre da Moneta…");
        setContentView(loading);
        new Thread(() -> {
            try { launch(); }
            catch (Exception e) { runOnUiThread(() -> loading.setText("Falha ao iniciar a Moneta. Feche e abra o aplicativo novamente. " + e.getMessage())); }
        }).start();
    }
    private void launch() throws Exception {
        File data = new File(getFilesDir(),"cofre");
        File code = new File(getCacheDir(),"moneta");
        code.mkdirs();
        try (ZipInputStream zip = new ZipInputStream(getAssets().open("app.zip"))) {
            for (ZipEntry entry; (entry = zip.getNextEntry()) != null;) {
                File file = new File(code,entry.getName());
                if (!file.getCanonicalPath().startsWith(code.getCanonicalPath()+"/")) throw new IOException("Arquivo inválido");
                if (entry.isDirectory()) { file.mkdirs(); continue; }
                file.getParentFile().mkdirs();
                Files.copy(zip,file.toPath(),java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            }
        }
        int port;
        int preferred = getPreferences(MODE_PRIVATE).getInt("port",0);
        InetAddress local = InetAddress.getByName("127.0.0.1");
        try (ServerSocket socket = new ServerSocket(preferred,1,local)) { port = socket.getLocalPort(); }
        catch (BindException busy) {
            try (ServerSocket socket = new ServerSocket(0,1,local)) { port = socket.getLocalPort(); }
        }
        getPreferences(MODE_PRIVATE).edit().putInt("port",port).apply();
        origin = "http://127.0.0.1:"+port;
        File libs = new File(getApplicationInfo().nativeLibraryDir);
        ProcessBuilder builder = new ProcessBuilder(new File(libs,"libmoneta_node.so").toString(),"server.mjs");
        builder.directory(code);
        Map<String,String> env = builder.environment();
        String boot = UUID.randomUUID().toString();
        env.put("MONETA_BOOT_ID",boot);
        env.put("MONETA_ANDROID_PARENT",String.valueOf(android.os.Process.myPid()));
        env.put("PORT",String.valueOf(port)); env.put("MONETA_DATA_DIR",data.toString());
        env.put("TMPDIR",getCacheDir().toString()); env.put("HOME",getFilesDir().toString());
        env.put("MONETA_SECRET_STORE","arquivo");
        env.put("NODE_EXTRA_CA_CERTS",new File(code,"ca.pem").toString());
        env.put("LD_LIBRARY_PATH",libs.toString());
        List<String> preload = new ArrayList<>();
        for (String name : new String[]{"libc++_shared","libz","libcrypto","libssl","libicudata","libicuuc","libicui18n"})
            preload.add(new File(libs,name+".so").toString());
        env.put("LD_PRELOAD",String.join(":",preload));
        ConnectivityManager networks = (ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);
        LinkProperties link = networks.getLinkProperties(networks.getActiveNetwork());
        if (link != null) for (LinkAddress a : link.getLinkAddresses()) {
            if (a.getAddress() instanceof Inet4Address && a.getAddress().isSiteLocalAddress())
                env.put("MONETA_WIFI_IP",a.getAddress().getHostAddress());
        }
        synchronized(this) {
            if (closed) return;
            builder.redirectErrorStream(true);
            // A saída contém o endereço de entrada privado. Nunca enviá-la ao logcat.
            builder.redirectOutput(new File("/dev/null"));
            server = builder.start();
        }
        for (int i=0;i<100 && !closed;i++) {
            if (!server.isAlive()) throw new IOException("O motor financeiro terminou ("+server.exitValue()+").");
            try {
                String key = new String(Files.readAllBytes(new File(data,"acesso.key").toPath())).trim();
                HttpURLConnection c = (HttpURLConnection)new URL(origin+"/api/status").openConnection();
                c.setConnectTimeout(300); c.setReadTimeout(700); c.setInstanceFollowRedirects(false);

                try (InputStream body=c.getInputStream(); Scanner scan=new Scanner(body,"UTF-8")) {
                    if (boot.equals(new JSONObject(scan.useDelimiter("\\A").next()).optString("boot"))) {
                        runOnUiThread(() -> display(key)); return;
                    }
                } finally { c.disconnect(); }
            } catch (IOException ignored) {}
            Thread.sleep(150);
        }
        if (!closed) throw new IOException("Tempo de inicialização excedido.");
    }
    private void display(String key) {
        if (closed) return;
        panel = new WebView(this);
        panel.setOnApplyWindowInsetsListener((v,insets) -> {
            v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            return insets;
        });
        setContentView(panel);
        WebSettings settings = panel.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        panel.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                String url = request.getUrl().toString();
                if (url.startsWith(origin+"/")) return false;
                if ("https".equals(request.getUrl().getScheme())) startActivity(new Intent(Intent.ACTION_VIEW,request.getUrl()));
                return true;
            }
        });
        panel.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                if (!request.getOrigin().toString().equals(origin) && !request.getOrigin().toString().equals(origin+"/")) { request.deny(); return; }
                if (!Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) { request.deny(); return; }
                camera=request;
                if (checkSelfPermission(Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED) allowCamera();
                else requestPermissions(new String[]{Manifest.permission.CAMERA},1);
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) { if (camera==request) camera=null; }
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> result,FileChooserParams params) {
                if (picker!=null) picker.onReceiveValue(null);
                picker=result;
                try { startActivityForResult(params.createIntent(),2); return true; }
                catch (android.content.ActivityNotFoundException e) { picker=null; return false; }
            }
        });
        panel.setDownloadListener((url,ua,cd,type,size) -> {
            if (!url.startsWith(origin+"/api/backup")) return;
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.addRequestHeader("Cookie",CookieManager.getInstance().getCookie(origin));
            request.setDestinationInExternalPublicDir(android.os.Environment.DIRECTORY_DOWNLOADS,URLUtil.guessFileName(url,cd,type));
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            ((DownloadManager)getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
        });
        panel.addJavascriptInterface(new Device(),"MonetaDevice");
        CookieManager.getInstance().setCookie(origin,"moneta_acesso="+key+"; Path=/; HttpOnly; SameSite=Strict");
        panel.loadUrl(origin+"/");
    }
    // ---- Biometria ------------------------------------------------------------------------------
    // A senha do modo cofre fica cifrada por uma chave do Android Keystore que só funciona depois da
    // digital, do rosto ou do bloqueio de tela. Nada sai do aparelho, e a chave nunca é exportável.
    private static final String KEY_ALIAS = "moneta-biometria";
    private android.content.SharedPreferences stored() { return getSharedPreferences("biometria",MODE_PRIVATE); }
    private boolean panelReady() { return panel != null && panel.getUrl() != null && panel.getUrl().startsWith(origin+"/"); }

    private final class Device {
        @JavascriptInterface public String biometric() {
            if (!available()) return "unavailable";
            return stored().contains("data") ? "enrolled" : "available";
        }
        @JavascriptInterface public void enroll(String password,String id) { runOnUiThread(() -> startEnroll(password,id)); }
        @JavascriptInterface public void unlock(String id) { runOnUiThread(() -> startUnlock(id)); }
        @JavascriptInterface public void forget() { forgetBiometric(); }
    }
    private boolean available() {
        if (!((android.app.KeyguardManager)getSystemService(KEYGUARD_SERVICE)).isDeviceSecure()) return false;
        if (Build.VERSION.SDK_INT >= 30)
            return getSystemService(BiometricManager.class).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG|BiometricManager.Authenticators.DEVICE_CREDENTIAL) == BiometricManager.BIOMETRIC_SUCCESS;
        if (Build.VERSION.SDK_INT == 29)
            return getSystemService(BiometricManager.class).canAuthenticate() == BiometricManager.BIOMETRIC_SUCCESS;
        android.hardware.fingerprint.FingerprintManager f = getSystemService(android.hardware.fingerprint.FingerprintManager.class);
        return f != null && f.isHardwareDetected() && f.hasEnrolledFingerprints();
    }
    private void forgetBiometric() {
        stored().edit().clear().apply();
        try { KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null); ks.deleteEntry(KEY_ALIAS); } catch (Exception ignored) {}
    }
    private SecretKey createKey() throws Exception {
        forgetBiometric();
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(KEY_ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).setUserAuthenticationRequired(true).setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= 30) spec.setUserAuthenticationParameters(0,KeyProperties.AUTH_BIOMETRIC_STRONG|KeyProperties.AUTH_DEVICE_CREDENTIAL);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        generator.init(spec.build());
        return generator.generateKey();
    }
    private void reply(String id,boolean ok,String value) {
        if (!panelReady()) return;
        try {
            String detail = new JSONObject().put("id",id).put("ok",ok).put("value",value == null ? "" : value).toString();
            panel.evaluateJavascript("window.dispatchEvent(new CustomEvent('moneta-device',{detail:"+JSONObject.quote(detail)+"}))",null);
        } catch (org.json.JSONException ignored) {}
    }
    private interface Done { void run(Cipher cipher) throws Exception; }
    private void prompt(String id,String subtitle,Cipher cipher,Done done) {
        BiometricPrompt.Builder builder = new BiometricPrompt.Builder(this).setTitle("Moneta").setSubtitle(subtitle);
        if (Build.VERSION.SDK_INT >= 30) builder.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG|BiometricManager.Authenticators.DEVICE_CREDENTIAL);
        else builder.setNegativeButton("Usar a senha",getMainExecutor(),(dialog,which) -> reply(id,false,"cancel"));
        builder.build().authenticate(new BiometricPrompt.CryptoObject(cipher),new CancellationSignal(),getMainExecutor(),new BiometricPrompt.AuthenticationCallback() {
            @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                try { done.run(result.getCryptoObject().getCipher()); }
                catch (Exception e) { reply(id,false,"Não foi possível usar a biometria. Use a senha."); }
            }
            @Override public void onAuthenticationError(int code,CharSequence message) {
                boolean cancel = code == BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED || code == BiometricPrompt.BIOMETRIC_ERROR_CANCELED;
                reply(id,false,cancel ? "cancel" : message.toString());
            }
        });
    }
    private void startEnroll(String password,String id) {
        if (!panelReady()) return;
        if (!available()) { reply(id,false,"Configure a digital, o rosto ou um bloqueio de tela no Android."); return; }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE,createKey());
            prompt(id,"Ativar o desbloqueio do cofre",cipher,ready -> {
                byte[] data = ready.doFinal(password.getBytes(StandardCharsets.UTF_8));
                stored().edit().putString("iv",Base64.encodeToString(ready.getIV(),Base64.NO_WRAP))
                    .putString("data",Base64.encodeToString(data,Base64.NO_WRAP)).apply();
                reply(id,true,null);
            });
        } catch (Exception e) { forgetBiometric(); reply(id,false,"Não foi possível ativar a biometria neste aparelho."); }
    }
    private void startUnlock(String id) {
        if (!panelReady()) return;
        String iv = stored().getString("iv",null), data = stored().getString("data",null);
        if (iv == null || data == null) { reply(id,false,"missing"); return; }
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE,(SecretKey)ks.getKey(KEY_ALIAS,null),new GCMParameterSpec(128,Base64.decode(iv,Base64.NO_WRAP)));
            prompt(id,"Destrancar o cofre",cipher,ready ->
                reply(id,true,new String(ready.doFinal(Base64.decode(data,Base64.NO_WRAP)),StandardCharsets.UTF_8)));
        } catch (KeyPermanentlyInvalidatedException e) {
            forgetBiometric();
            reply(id,false,"A biometria do aparelho mudou. Digite a senha e ative o desbloqueio de novo em Configuração.");
        } catch (Exception e) { forgetBiometric(); reply(id,false,"missing"); }
    }

    private void allowCamera() { if (camera!=null) camera.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE}); camera=null; }
    @Override public void onRequestPermissionsResult(int code,String[] perms,int[] results) {
        super.onRequestPermissionsResult(code,perms,results);
        if (code==1 && camera!=null) {
            if (results.length>0 && results[0]==PackageManager.PERMISSION_GRANTED) allowCamera();
            else { camera.deny(); camera=null; }
        }
    }
    @Override protected void onActivityResult(int code,int result,Intent intent) {
        super.onActivityResult(code,result,intent);
        if (code==2 && picker!=null) { picker.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,intent)); picker=null; }
    }
    @Override public void onBackPressed() { if (panel!=null && panel.canGoBack()) panel.goBack(); else finish(); }
    @Override protected synchronized void onDestroy() {
        closed=true;
        if (server!=null) server.destroy();
        if (panel!=null) panel.destroy();
        super.onDestroy();
    }
}
