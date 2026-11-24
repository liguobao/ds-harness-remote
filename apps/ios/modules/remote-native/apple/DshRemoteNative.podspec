Pod::Spec.new do |s|
  s.name = 'DshRemoteNative'
  s.version = JSON.parse(File.read(File.join(__dir__, '../package.json')))['version']
  s.summary = 'Native services for DSH Remote'
  s.homepage = 'https://github.com/liguobao/ds-harness-remote'
  s.license = 'MIT'
  s.author = 'DSH Remote'
  s.source = { :git => s.homepage + '.git' }
  s.platform = :ios, '16.4'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '*.swift'
end
